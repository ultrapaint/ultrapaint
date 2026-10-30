/**
 * The built-in agents as the app runs them (PLAN-desktop D8): their ACP adapters bundled into
 * the app and started on Electron's own binary, each told where its agent is. The agent is found
 * as T3 Code finds it: at the path set in the app's settings, or on the login shell's PATH. Its
 * sign-in is asked of the agent itself, so the editor can say which agents are ready. What each
 * agent is (its program, adapter, sign-in, key and variables) is its descriptor in acp's
 * `built-in`; nothing here names one.
 *
 * The servers the app starts are handed the runtime (`ULTRAPAINT_AGENT_RUNTIME`), asked again at
 * each start, so a change applies to the next start of a project.
 */
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { refusingHandlers, spawnAcpAgent } from "@ultrapaint/acp/acp-agent";
import {
  BUILT_IN_AGENTS,
  type BuiltInAgent,
  type BuiltInAgents,
  type ExecutableSource,
  type SignInAnswer,
} from "@ultrapaint/acp/built-in";
import {
  type AgentRuntime,
  type RuntimeAgent,
  runtimeLaunch,
} from "@ultrapaint/acp/runtime";
import type { PlatformAgent } from "@ultrapaint/contracts/shell-bridge";
import type { BuiltInAgentId } from "@ultrapaint/contracts/threads";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { AgentDownloads, DownloadError } from "./agent-downloads.ts";
import { type AgentSetting, AgentSettings } from "./agent-settings.ts";
import { runCommand } from "./command.ts";
import type { StoreError } from "./errors.ts";
import { LoginShell } from "./login-shell.ts";
import { type SecretError, Secrets } from "./secrets.ts";
import { findExecutable, isExecutable } from "./which.ts";

/** Where the app's own parts are. */
export interface AppLayout {
  /** The bundled adapters and the script that starts them. */
  readonly adaptersDir: string;
  /** Electron's binary, which runs the adapters as Node. */
  readonly node: string;
  /** The app's version, which an adapter it signs an agent in through is told. */
  readonly version?: string;
}

/** A path as the sandbox sees it: where it really is, links followed. */
const real = (file: string) => {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
};

/**
 * What of Electron an agent in the sandbox needs to read: the directory of its binary, or on
 * macOS the whole app bundle, whose frameworks the binary loads.
 */
export const electronReads = (node: string) => {
  const binary = real(node);
  const bundle = binary.indexOf(".app/Contents/MacOS/");
  return bundle === -1
    ? path.dirname(binary)
    : binary.slice(0, bundle + ".app".length);
};

/** How the app found an agent: its executable, and what else its adapter is told. */
export interface FoundAgent {
  /** Further variables: the key it signs in with, when the user gave one. */
  readonly env?: Readonly<Record<string, string>>;
  readonly executable: string;
}

/**
 * The runtime for the agents found: each built-in agent's adapter, told where its agent is; an
 * agent not found still gets its adapter, which then fails to start with `hints`' word on how to
 * install it.
 */
export const makeRuntime = (
  layout: AppLayout,
  found: Readonly<Partial<Record<BuiltInAgentId, FoundAgent>>>,
  hints: Readonly<Partial<Record<BuiltInAgentId, string>>> = {},
  agents: BuiltInAgents = BUILT_IN_AGENTS
): AgentRuntime => {
  const adapters: Record<string, RuntimeAgent> = {};
  for (const agent of Object.values(agents)) {
    const at = found[agent.id];
    const hint = hints[agent.id];
    adapters[agent.id] = {
      adapter: path.join(layout.adaptersDir, `${agent.adapter.bundle}.mjs`),
      env: at ? { ...at.env, [agent.executable.env]: at.executable } : {},
      ...(hint === undefined ? {} : { hint }),
    };
  }
  return {
    agents: adapters,
    node: layout.node,
    reads: [
      ...new Set([
        electronReads(layout.node),
        real(layout.adaptersDir),
        // The agent's own directory: a downloaded one is in the app's data, under the home.
        ...Object.values(found).map((agent) =>
          path.dirname(real(agent.executable))
        ),
      ]),
    ],
    wrapper: path.join(layout.adaptersDir, "run.mjs"),
  };
};

/** Where the executable came from, or why there is none. */
export type Located =
  | {
      readonly _tag: "Found";
      readonly executable: string;
      readonly source: ExecutableSource;
    }
  | { readonly _tag: "Missing"; readonly reason: string };

const VERSION_RE = /\d+\.\d+\.\d+[\w.-]*/;

/** The version an agent's `--version` names. */
export const versionIn = (output: string) => {
  const match: RegExpExecArray | null = VERSION_RE.exec(output);
  return match ? match[0] : undefined;
};

export class SignInError extends Schema.TaggedError<SignInError>()(
  "SignInError",
  { message: Schema.String }
) {}

/** How long the user has to sign in, in the browser, before the app gives up waiting. */
const SIGN_IN_TIMEOUT = "10 minutes";

/**
 * What a signed-out agent's status tells the user to do: sign in through the app where its
 * adapter can, else by themselves; or give a key here, or in their shell where no keychain could
 * keep one.
 */
export const signInHint = (agent: BuiltInAgent, keychain: boolean) => {
  const { adapter, yourself } = agent.signIn;
  const signIn = adapter
    ? `Sign in with ${adapter.with} below, or ${yourself}`
    : `Sign in with ${agent.name}: ${yourself}`;
  if (agent.apiKeyEnv === undefined) {
    return `${signIn}.`;
  }
  return keychain
    ? `${signIn}, or give an API key below.`
    : `${signIn}, or set ${agent.apiKeyEnv} in your shell's startup file.`;
};

export class Agents extends Context.Service<
  Agents,
  {
    /** Downloads the agent's pinned release into the app's data (D8): the executable. */
    readonly download: (
      id: BuiltInAgentId
    ) => Effect.Effect<string, DownloadError>;
    /** Where an agent's executable is, if anywhere. */
    readonly locate: (id: BuiltInAgentId) => Effect.Effect<Located>;
    /** The runtime for the next server the app starts. */
    readonly runtime: Effect.Effect<AgentRuntime>;
    /**
     * Keeps the key an agent signs in with (Claude Code's), encrypted by the keychain;
     * `undefined` forgets it. Given to its adapter alone, in the variable its descriptor names.
     */
    readonly setApiKey: (
      id: BuiltInAgentId,
      key: string | undefined
    ) => Effect.Effect<void, StoreError | SecretError | SignInError>;
    /**
     * Signs an agent in through its adapter's own method (Codex's ChatGPT), which opens the
     * browser; done once the user has.
     */
    readonly signIn: (id: BuiltInAgentId) => Effect.Effect<void, SignInError>;
    /** How each agent stands: found, signed in, or what can be done about it. */
    readonly status: Effect.Effect<readonly PlatformAgent[]>;
  }
>()("ultrapaint/desktop/Agents") {
  /** The built-in agents, or those a test describes. */
  static readonly layer = (
    layout: AppLayout,
    agents: BuiltInAgents = BUILT_IN_AGENTS
  ) =>
    Layer.effect(
      Agents,
      Effect.gen(function* () {
        const { env } = yield* LoginShell;
        const settings = yield* AgentSettings;
        const downloads = yield* AgentDownloads;
        const secrets = yield* Secrets;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const searchPath = env.PATH ?? "";
        const all: readonly BuiltInAgent[] = Object.values(agents);
        const settingOf = (id: BuiltInAgentId) =>
          Effect.orElseSucceed(settings.get(id), (): AgentSetting => ({}));

        const locate = Effect.fn("Agents.locate")(function* (
          id: BuiltInAgentId
        ) {
          const { program } = agents[id].executable;
          const setting = yield* settingOf(id);
          if (setting.path !== undefined) {
            return (yield* isExecutable(setting.path))
              ? ({
                  _tag: "Found",
                  executable: setting.path,
                  source: "setting",
                } as Located)
              : ({
                  _tag: "Missing",
                  reason: `${setting.path}, set in the app's settings, is not a program that runs.`,
                } as Located);
          }
          // The user's own first; the one the app downloaded only where there is none.
          const onPath = yield* findExecutable(program, searchPath);
          if (Option.isSome(onPath)) {
            return {
              _tag: "Found",
              executable: onPath.value,
              source: "path",
            } as Located;
          }
          const downloaded = yield* downloads.installed(id);
          return Option.match(downloaded, {
            onNone: (): Located => ({
              _tag: "Missing",
              reason: `\`${program}\` is not on your PATH.`,
            }),
            onSome: (executable): Located => ({
              _tag: "Found",
              executable,
              source: "download",
            }),
          });
        });

        /** The key kept for the agent, decrypted; none when there is none or it cannot be read. */
        const apiKeyOf = (id: BuiltInAgentId) =>
          Effect.flatMap(settingOf(id), (setting) =>
            setting.apiKey === undefined
              ? Effect.succeed(Option.none<string>())
              : Effect.option(secrets.decrypt(setting.apiKey))
          );

        /** Runs the agent itself, as the user would in a terminal. */
        const ask = (executable: string, args: readonly string[]) =>
          runCommand(executable, args, { env, timeout: "20 seconds" }).pipe(
            Effect.provideService(
              ChildProcessSpawner.ChildProcessSpawner,
              spawner
            ),
            Effect.option
          );

        /** What the settings can do for a missing agent: download it, and how far that got. */
        const offerFor = Effect.fnUntraced(function* (id: BuiltInAgentId) {
          const release = downloads.offer(id);
          const progress = yield* downloads.progress(id);
          return {
            ...Option.match(release, {
              onNone: () => ({}),
              onSome: (r) => ({
                download: {
                  size: r.kind === "zst-binary" ? r.zstSize : r.size,
                  version: r.version,
                },
              }),
            }),
            ...Option.match(progress, {
              onNone: () => ({}),
              onSome: (p) => ({ downloading: p }),
            }),
          };
        });

        /** Asks the agent whether it is signed in, as its descriptor says to. */
        const signInOf = (agent: BuiltInAgent, executable: string) =>
          Effect.map(
            ask(executable, agent.signIn.status),
            Option.match({
              onNone: (): SignInAnswer => ({ how: undefined, signedIn: false }),
              onSome: agent.signIn.parse,
            })
          );

        /** What every status of the agent says, found or not. */
        const commonOf = (agent: BuiltInAgent, setting: AgentSetting) => ({
          ...(setting.path === undefined ? {} : { customPath: setting.path }),
          ...(agent.apiKeyEnv === undefined
            ? {}
            : {
                apiKey: setting.apiKey !== undefined,
                canKeepKey: secrets.available,
              }),
          id: agent.id,
          install: agent.executable.install,
          name: agent.name,
          ...(agent.signIn.adapter
            ? { signInWith: agent.signIn.adapter.with }
            : {}),
        });

        /** Whether a found agent is ready: its own sign-in, or the key kept for it. */
        const signInState = (
          agent: BuiltInAgent,
          keyed: boolean,
          answer: SignInAnswer
        ): Pick<PlatformAgent, "detail" | "state"> => {
          if (keyed) {
            return {
              detail: "Signs in with the API key given here.",
              state: "ready",
            };
          }
          if (answer.signedIn) {
            return {
              detail: answer.how ? `Signed in ${answer.how}.` : "Signed in.",
              state: "ready",
            };
          }
          // Without a keychain no key is kept here: the shell's own variable is the way.
          return {
            detail: `Not signed in. ${signInHint(agent, secrets.available)}`,
            state: "signed-out",
          };
        };

        const statusOf = Effect.fn("Agents.statusOf")(function* (
          agent: BuiltInAgent
        ) {
          const located = yield* locate(agent.id);
          const setting = yield* settingOf(agent.id);
          const common = commonOf(agent, setting);
          if (located._tag === "Missing") {
            return {
              ...common,
              ...(yield* offerFor(agent.id)),
              detail: `Not installed: ${located.reason}`,
              state: "missing",
            } satisfies PlatformAgent;
          }
          const [version, signIn] = yield* Effect.all(
            [
              ask(located.executable, ["--version"]),
              signInOf(agent, located.executable),
            ],
            { concurrency: 2 }
          );
          return {
            ...common,
            executable: located.executable,
            source: located.source,
            ...Option.match(
              Option.flatMap(version, (v) =>
                Option.fromNullishOr(versionIn(v.stdout))
              ),
              { onNone: () => ({}), onSome: (v) => ({ version: v }) }
            ),
            ...signInState(
              agent,
              agent.apiKeyEnv !== undefined && setting.apiKey !== undefined,
              signIn
            ),
          } satisfies PlatformAgent;
        });

        /** What an agent's adapter is told besides where the agent is: its key, its variables. */
        const envOf = Effect.fnUntraced(function* (
          agent: BuiltInAgent,
          source: ExecutableSource
        ) {
          const key =
            agent.apiKeyEnv === undefined
              ? Option.none<string>()
              : yield* apiKeyOf(agent.id);
          return {
            ...(agent.apiKeyEnv !== undefined && Option.isSome(key)
              ? { [agent.apiKeyEnv]: key.value }
              : {}),
            ...agent.env?.[source],
          };
        });

        const runtime = Effect.gen(function* () {
          const found: Partial<Record<BuiltInAgentId, FoundAgent>> = {};
          const hints: Partial<Record<BuiltInAgentId, string>> = {};
          for (const agent of all) {
            const located = yield* locate(agent.id);
            if (located._tag === "Found") {
              found[agent.id] = {
                env: yield* envOf(agent, located.source),
                executable: located.executable,
              };
            } else {
              hints[agent.id] =
                `${agent.name} is not installed: ${located.reason} Install it (${agent.executable.install}), download it or set where it is in Settings, under Agents.`;
            }
          }
          return makeRuntime(layout, found, hints, agents);
        });

        const setApiKey = Effect.fn("Agents.setApiKey")(function* (
          id: BuiltInAgentId,
          key: string | undefined
        ) {
          const agent: BuiltInAgent = agents[id];
          if (agent.apiKeyEnv === undefined) {
            return yield* new SignInError({
              message: `${agent.name} takes no API key here`,
            });
          }
          if (key !== undefined && !secrets.available) {
            return yield* new SignInError({
              message: `This computer has no keychain to keep the key in. Set ${agent.apiKeyEnv} in your shell's startup file instead.`,
            });
          }
          const sealed =
            key === undefined ? undefined : yield* secrets.encrypt(key.trim());
          yield* settings.update(id, (setting) => ({
            ...setting,
            apiKey: sealed,
          }));
        });

        const signIn = Effect.fn("Agents.signIn")(
          function* (id: BuiltInAgentId) {
            const agent: BuiltInAgent = agents[id];
            const method = agent.signIn.adapter;
            if (method === undefined) {
              return yield* new SignInError({
                message: `${agent.name} signs in by itself: ${agent.signIn.yourself}.`,
              });
            }
            const located = yield* locate(id);
            if (located._tag === "Missing") {
              return yield* new SignInError({
                message: `${agent.name} is not installed: ${located.reason}`,
              });
            }
            const launch = runtimeLaunch(
              makeRuntime(
                layout,
                { [id]: { executable: located.executable } },
                {},
                agents
              ),
              id
            );
            if (launch === undefined) {
              return yield* new SignInError({
                message: `${agent.name} has no adapter in this app.`,
              });
            }
            const adapter = yield* spawnAcpAgent(
              { ...launch, env: { ...env, ...launch.env } },
              {
                clientVersion: layout.version ?? "dev",
                cwd: tmpdir(),
                // A sign-in asks for nothing of the editor: whatever the adapter asks is refused.
                handlers: refusingHandlers("the app is only signing in"),
              }
            );
            const init = yield* adapter.initialize;
            if (!init.authMethods?.some((m) => m.id === method.method)) {
              return yield* new SignInError({
                message: `This ${agent.name} adapter offers no ${method.with} sign-in: ${agent.signIn.yourself}.`,
              });
            }
            // The adapter opens the browser and answers once the sign-in is done there.
            yield* adapter.authenticate(method.method);
          },
          Effect.scoped,
          Effect.timeout(SIGN_IN_TIMEOUT),
          (effect, id) =>
            Effect.mapError(effect, (error) =>
              error._tag === "SignInError"
                ? error
                : new SignInError({
                    message:
                      error._tag === "TimeoutError"
                        ? `The sign-in was not finished within ${SIGN_IN_TIMEOUT}.`
                        : `${agents[id].name} could not sign in: ${error.message}`,
                  })
            )
        );

        return Agents.of({
          download: (id) => downloads.download(id),
          locate,
          runtime,
          setApiKey,
          signIn,
          status: Effect.forEach(all, statusOf, { concurrency: 2 }),
        });
      })
    );

  /** A fixed runtime, for tests. */
  static readonly layerTest = (runtime: AgentRuntime) =>
    Layer.succeed(
      Agents,
      Agents.of({
        download: () => Effect.fail(new DownloadError({ message: "a test" })),
        locate: () =>
          Effect.succeed({ _tag: "Missing", reason: "a test" } as Located),
        runtime: Effect.succeed(runtime),
        setApiKey: () => Effect.void,
        signIn: () => Effect.void,
        status: Effect.succeed([]),
      })
    );
}
