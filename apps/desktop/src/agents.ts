/**
 * The built-in agents as the app runs them (PLAN-desktop D8): their ACP adapters bundled into
 * the app and started on Electron's own binary, each told where its agent is. The agent is found
 * as T3 Code finds it: at the path set in the app's settings, or on the login shell's PATH. Its
 * sign-in is asked of the agent itself, so the editor can say which agents are ready.
 *
 * The servers the app starts are handed the runtime (`ULTRAPAINT_AGENT_RUNTIME`), asked again at
 * each start, so a change applies to the next start of a project.
 */
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type AcpHandlers, spawnAcpAgent } from "@ultrapaint/acp/acp-agent";
import type { AgentRuntime, RuntimeAgent } from "@ultrapaint/acp/runtime";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { AgentDownloads, DownloadError } from "./agent-downloads.ts";
import { type AgentSetting, AgentSettings } from "./agent-settings.ts";
import { runCommand } from "./command.ts";
import type { StoreError } from "./errors.ts";
import type { AgentStatus } from "./ipc.ts";
import { LoginShell } from "./login-shell.ts";
import { type SecretError, Secrets } from "./secrets.ts";
import { findExecutable, isExecutable } from "./which.ts";

/** The built-in agents the app brings an adapter for. */
export const AGENTS = {
  "claude-code": {
    adapter: "claude-agent-acp.mjs",
    /** claude-agent-acp's `claudeCliPath()` takes it before its own SDK's binary. */
    executableEnv: "CLAUDE_CODE_EXECUTABLE",
    install: "https://code.claude.com/docs/en/setup",
    name: "Claude Code",
    program: "claude",
    /**
     * No sign-in button: a third-party product may not offer claude.ai sign-in without
     * Anthropic's approval. The user signs in with Claude Code itself, or gives an API key.
     */
    signIn:
      "Sign in with Claude Code: run `claude` once in a terminal, or give an API key below.",
  },
  codex: {
    adapter: "codex-acp.mjs",
    /** codex-acp runs it in place of the `@openai/codex` it depends on. */
    executableEnv: "CODEX_PATH",
    install: "https://developers.openai.com/codex/cli",
    name: "Codex",
    program: "codex",
    signIn: "Sign in with ChatGPT below, or run `codex login` in a terminal.",
  },
} as const;
export type AgentId = keyof typeof AGENTS;
export const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

export const isAgentId = (id: string): id is AgentId => id in AGENTS;

/** Where the app's own parts are. */
export interface AppLayout {
  /** The bundled adapters and the script that starts them. */
  readonly adaptersDir: string;
  /** Electron's binary, which runs the adapters as Node. */
  readonly node: string;
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
 * The runtime for the agents found: each adapter, told where its agent is; an agent not found
 * still gets its adapter, which then fails to start with `hints`' word on how to install it.
 */
export const makeRuntime = (
  layout: AppLayout,
  found: Readonly<Partial<Record<AgentId, FoundAgent>>>,
  hints: Readonly<Partial<Record<AgentId, string>>> = {}
): AgentRuntime => {
  const agents: Record<string, RuntimeAgent> = {};
  for (const id of AGENT_IDS) {
    const agent = found[id];
    const hint = hints[id];
    agents[id] = {
      adapter: path.join(layout.adaptersDir, AGENTS[id].adapter),
      env: agent
        ? { ...agent.env, [AGENTS[id].executableEnv]: agent.executable }
        : {},
      ...(hint === undefined ? {} : { hint }),
    };
  }
  return {
    agents,
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
      readonly source: "path" | "setting" | "download";
    }
  | { readonly _tag: "Missing"; readonly reason: string };

const ClaudeAuth = Schema.fromJsonString(
  Schema.Struct({
    authMethod: Schema.optional(Schema.String),
    loggedIn: Schema.Boolean,
  })
);
const decodeClaudeAuth = Schema.decodeUnknownOption(ClaudeAuth);

/** What `claude auth status` says, as a sign-in: its JSON, or failing that its exit code. */
export const claudeSignIn = (result: {
  readonly exitCode: number;
  readonly stdout: string;
}) =>
  Option.match(decodeClaudeAuth(result.stdout.trim()), {
    onNone: () => ({ how: undefined, signedIn: result.exitCode === 0 }),
    onSome: (auth) => ({
      how:
        {
          api_key: "with an API key",
          "claude.ai": "with claude.ai",
          none: undefined,
        }[auth.authMethod ?? "none"] ?? auth.authMethod,
      signedIn: auth.loggedIn,
    }),
  });

const LOGGED_IN_RE = /^Logged in using (.+)$/;

/** What `codex login status` says: signed in when it exits 0, and how, in its own words. */
export const codexSignIn = (result: {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}) => {
  const line = `${result.stdout}\n${result.stderr}`
    .split("\n")
    .map((l) => LOGGED_IN_RE.exec(l.trim()))
    .find((match) => match !== null);
  return {
    how: result.exitCode === 0 && line?.[1] ? `with ${line[1]}` : undefined,
    signedIn: result.exitCode === 0,
  };
};

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

/** A sign-in asks for nothing of the editor: whatever the adapter asks for is refused. */
const refuse = Effect.fail({ message: "the app is only signing in" });
const refusing: AcpHandlers = {
  onElicitation: () => Effect.succeed({ action: "decline" }),
  onPermission: () => Effect.succeed({ outcome: { outcome: "cancelled" } }),
  onStderr: () => Effect.void,
  readTextFile: () => refuse,
  terminal: {
    create: () => refuse,
    kill: () => Effect.void,
    output: () => refuse,
    release: () => Effect.void,
    waitForExit: () => refuse,
  },
  writeTextFile: () => refuse,
};

/** How long the user has to sign in, in the browser, before the app gives up waiting. */
const SIGN_IN_TIMEOUT = "10 minutes";

export class Agents extends Context.Service<
  Agents,
  {
    /** Downloads the agent's pinned release into the app's data (D8): the executable. */
    readonly download: (id: AgentId) => Effect.Effect<string, DownloadError>;
    /** Where an agent's executable is, if anywhere. */
    readonly locate: (id: AgentId) => Effect.Effect<Located>;
    /** The runtime for the next server the app starts. */
    readonly runtime: Effect.Effect<AgentRuntime>;
    /**
     * Keeps the key Claude Code signs in with, encrypted by the keychain; `undefined` forgets it.
     * Given to Claude Code's adapter alone, as `ANTHROPIC_API_KEY`.
     */
    readonly setApiKey: (
      id: AgentId,
      key: string | undefined
    ) => Effect.Effect<void, StoreError | SecretError | SignInError>;
    /**
     * Signs Codex in with ChatGPT through its adapter's own flow, which opens the browser; done
     * once the user has.
     */
    readonly signIn: (id: AgentId) => Effect.Effect<void, SignInError>;
    /** How each agent stands: found, signed in, or what can be done about it. */
    readonly status: Effect.Effect<readonly AgentStatus[]>;
  }
>()("ultrapaint/desktop/Agents") {
  static readonly layer = (layout: AppLayout) =>
    Layer.effect(
      Agents,
      Effect.gen(function* () {
        const { env } = yield* LoginShell;
        const settings = yield* AgentSettings;
        const downloads = yield* AgentDownloads;
        const secrets = yield* Secrets;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const searchPath = env.PATH ?? "";
        const settingOf = (id: AgentId) =>
          Effect.orElseSucceed(settings.get(id), (): AgentSetting => ({}));

        const locate = Effect.fn("Agents.locate")(function* (id: AgentId) {
          const agent = AGENTS[id];
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
          const onPath = yield* findExecutable(agent.program, searchPath);
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
              reason: `\`${agent.program}\` is not on your PATH.`,
            }),
            onSome: (executable): Located => ({
              _tag: "Found",
              executable,
              source: "download",
            }),
          });
        });

        /** The key kept for the agent, decrypted; none when there is none or it cannot be read. */
        const apiKeyOf = (id: AgentId) =>
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
        const offerFor = Effect.fnUntraced(function* (id: AgentId) {
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

        const signInOf = Effect.fnUntraced(function* (
          id: AgentId,
          executable: string
        ) {
          const auth =
            id === "claude-code"
              ? yield* ask(executable, ["auth", "status"])
              : yield* ask(executable, ["login", "status"]);
          return Option.match(auth, {
            onNone: () => ({ how: undefined, signedIn: false }),
            onSome: id === "claude-code" ? claudeSignIn : codexSignIn,
          });
        });

        /** What every status of the agent says, found or not. */
        const commonOf = (id: AgentId, setting: AgentSetting) => ({
          ...(setting.path === undefined ? {} : { customPath: setting.path }),
          ...(id === "claude-code"
            ? {
                apiKey: setting.apiKey !== undefined,
                canKeepKey: secrets.available,
              }
            : {}),
          id,
          install: AGENTS[id].install,
          name: AGENTS[id].name,
          signIn:
            id === "claude-code" ? ("terminal" as const) : ("chatgpt" as const),
        });

        /** Whether a found agent is ready: its own sign-in, or the key kept for it. */
        const signInState = (
          id: AgentId,
          keyed: boolean,
          answer: {
            readonly how: string | undefined;
            readonly signedIn: boolean;
          }
        ): Pick<AgentStatus, "detail" | "state"> => {
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
          const how =
            id === "claude-code" && !secrets.available
              ? "Sign in with Claude Code: run `claude` once in a terminal, or set ANTHROPIC_API_KEY in your shell's startup file."
              : AGENTS[id].signIn;
          return { detail: `Not signed in. ${how}`, state: "signed-out" };
        };

        const statusOf = Effect.fn("Agents.statusOf")(function* (id: AgentId) {
          const located = yield* locate(id);
          const setting = yield* settingOf(id);
          const common = commonOf(id, setting);
          if (located._tag === "Missing") {
            return {
              ...common,
              ...(yield* offerFor(id)),
              detail: `Not installed: ${located.reason}`,
              state: "missing",
            } satisfies AgentStatus;
          }
          const [version, signIn] = yield* Effect.all(
            [
              ask(located.executable, ["--version"]),
              signInOf(id, located.executable),
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
              id,
              id === "claude-code" && setting.apiKey !== undefined,
              signIn
            ),
          } satisfies AgentStatus;
        });

        /** What an agent's adapter is told besides where the agent is. */
        const envOf = Effect.fnUntraced(function* (
          id: AgentId,
          source: "path" | "setting" | "download"
        ) {
          if (id !== "claude-code") {
            return {};
          }
          const key = yield* apiKeyOf(id);
          return {
            ...(Option.isSome(key) ? { ANTHROPIC_API_KEY: key.value } : {}),
            // The release the app downloaded stays the one it checked: Claude Code updating
            // itself would also put a launcher in the user's ~/.local/bin.
            ...(source === "download" ? { DISABLE_AUTOUPDATER: "1" } : {}),
          };
        });

        const runtime = Effect.gen(function* () {
          const found: Partial<Record<AgentId, FoundAgent>> = {};
          const hints: Partial<Record<AgentId, string>> = {};
          for (const id of AGENT_IDS) {
            const agent = AGENTS[id];
            const located = yield* locate(id);
            if (located._tag === "Found") {
              found[id] = {
                env: yield* envOf(id, located.source),
                executable: located.executable,
              };
            } else {
              hints[id] =
                `${agent.name} is not installed: ${located.reason} Install it (${agent.install}), download it or set where it is in Settings, under Agents.`;
            }
          }
          return makeRuntime(layout, found, hints);
        });

        const setApiKey = Effect.fn("Agents.setApiKey")(function* (
          id: AgentId,
          key: string | undefined
        ) {
          if (id !== "claude-code") {
            return yield* new SignInError({
              message: `${AGENTS[id].name} takes no API key here`,
            });
          }
          if (key !== undefined && !secrets.available) {
            return yield* new SignInError({
              message:
                "This computer has no keychain to keep the key in. Set ANTHROPIC_API_KEY in your shell's startup file instead.",
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
          function* (id: AgentId) {
            if (id !== "codex") {
              return yield* new SignInError({
                message:
                  "Claude Code signs in by itself: run `claude` once in a terminal.",
              });
            }
            const located = yield* locate(id);
            if (located._tag === "Missing") {
              return yield* new SignInError({
                message: `Codex is not installed: ${located.reason}`,
              });
            }
            const runtimeAgent = makeRuntime(layout, {
              codex: { executable: located.executable },
            });
            const agent = yield* spawnAcpAgent(
              {
                args: [
                  runtimeAgent.wrapper,
                  runtimeAgent.agents.codex?.adapter ?? "",
                ],
                command: layout.node,
                env: {
                  ...env,
                  ...runtimeAgent.agents.codex?.env,
                  ELECTRON_RUN_AS_NODE: "1",
                },
              },
              { cwd: tmpdir(), handlers: refusing }
            );
            const init = yield* agent.initialize;
            if (!init.authMethods?.some((m) => m.id === "chat-gpt")) {
              return yield* new SignInError({
                message:
                  "This Codex adapter offers no ChatGPT sign-in: run `codex login` in a terminal.",
              });
            }
            // The adapter opens the browser and answers once the sign-in is done there.
            yield* agent.authenticate("chat-gpt");
          },
          Effect.scoped,
          Effect.timeout(SIGN_IN_TIMEOUT),
          Effect.mapError((error) =>
            error._tag === "SignInError"
              ? error
              : new SignInError({
                  message:
                    error._tag === "TimeoutError"
                      ? `The sign-in was not finished within ${SIGN_IN_TIMEOUT}.`
                      : `Codex could not sign in: ${error.message}`,
                })
          )
        );

        return Agents.of({
          download: (id) => downloads.download(id),
          locate,
          runtime,
          setApiKey,
          signIn,
          status: Effect.forEach(AGENT_IDS, statusOf, { concurrency: 2 }),
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
