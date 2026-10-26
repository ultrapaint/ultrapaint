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
import path from "node:path";
import type { AgentRuntime, RuntimeAgent } from "@ultrapaint/acp/runtime";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { type AgentSetting, AgentSettings } from "./agent-settings.ts";
import { runCommand } from "./command.ts";
import type { AgentStatus } from "./ipc.ts";
import { LoginShell } from "./login-shell.ts";
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
    signIn: "Run `claude` once in a terminal to sign in.",
  },
  codex: {
    adapter: "codex-acp.mjs",
    /** codex-acp runs it in place of the `@openai/codex` it depends on. */
    executableEnv: "CODEX_PATH",
    install: "https://developers.openai.com/codex/cli",
    name: "Codex",
    program: "codex",
    signIn: "Run `codex login` once in a terminal to sign in.",
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
      readonly source: "path" | "setting";
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

export class Agents extends Context.Service<
  Agents,
  {
    /** Where an agent's executable is, if anywhere. */
    readonly locate: (id: AgentId) => Effect.Effect<Located>;
    /** The runtime for the next server the app starts. */
    readonly runtime: Effect.Effect<AgentRuntime>;
    /** How each agent stands: found, signed in. */
    readonly status: Effect.Effect<readonly AgentStatus[]>;
  }
>()("ultrapaint/desktop/Agents") {
  static readonly layer = (layout: AppLayout) =>
    Layer.effect(
      Agents,
      Effect.gen(function* () {
        const { env } = yield* LoginShell;
        const settings = yield* AgentSettings;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const searchPath = env.PATH ?? "";

        const locate = Effect.fn("Agents.locate")(function* (id: AgentId) {
          const agent = AGENTS[id];
          const setting = yield* Effect.orElseSucceed(
            settings.get(id),
            (): AgentSetting => ({})
          );
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
          const onPath = yield* findExecutable(agent.program, searchPath);
          return Option.match(onPath, {
            onNone: (): Located => ({
              _tag: "Missing",
              reason: `\`${agent.program}\` is not on your PATH.`,
            }),
            onSome: (executable): Located => ({
              _tag: "Found",
              executable,
              source: "path",
            }),
          });
        });

        /** Runs the agent itself, as the user would in a terminal. */
        const ask = (executable: string, args: readonly string[]) =>
          runCommand(executable, args, { env, timeout: "20 seconds" }).pipe(
            Effect.provideService(
              ChildProcessSpawner.ChildProcessSpawner,
              spawner
            ),
            Effect.option
          );

        const statusOf = Effect.fn("Agents.statusOf")(function* (id: AgentId) {
          const agent = AGENTS[id];
          const located = yield* locate(id);
          const setting = yield* Effect.orElseSucceed(
            settings.get(id),
            (): AgentSetting => ({})
          );
          const common = {
            ...(setting.path === undefined ? {} : { customPath: setting.path }),
            id,
            install: agent.install,
            name: agent.name,
          };
          if (located._tag === "Missing") {
            return {
              ...common,
              detail: `Not installed: ${located.reason}`,
              state: "missing",
            } satisfies AgentStatus;
          }
          const [version, auth] = yield* Effect.all(
            [
              ask(located.executable, ["--version"]),
              id === "claude-code"
                ? ask(located.executable, ["auth", "status"])
                : ask(located.executable, ["login", "status"]),
            ],
            { concurrency: 2 }
          );
          const signIn = Option.match(auth, {
            onNone: () => ({ how: undefined, signedIn: false }),
            onSome: id === "claude-code" ? claudeSignIn : codexSignIn,
          });
          const found = {
            ...common,
            executable: located.executable,
            source: located.source,
            ...Option.match(
              Option.flatMap(version, (v) =>
                Option.fromNullishOr(versionIn(v.stdout))
              ),
              { onNone: () => ({}), onSome: (v) => ({ version: v }) }
            ),
          };
          return signIn.signedIn
            ? ({
                ...found,
                detail: signIn.how ? `Signed in ${signIn.how}.` : "Signed in.",
                state: "ready",
              } satisfies AgentStatus)
            : ({
                ...found,
                detail: `Not signed in. ${agent.signIn}`,
                state: "signed-out",
              } satisfies AgentStatus);
        });

        const runtime = Effect.gen(function* () {
          const found: Partial<Record<AgentId, FoundAgent>> = {};
          const hints: Partial<Record<AgentId, string>> = {};
          for (const id of AGENT_IDS) {
            const agent = AGENTS[id];
            const located = yield* locate(id);
            if (located._tag === "Found") {
              found[id] = { executable: located.executable };
            } else {
              hints[id] =
                `${agent.name} is not installed: ${located.reason} Install it (${agent.install}), or set where it is in Settings, under Agents.`;
            }
          }
          return makeRuntime(layout, found, hints);
        });

        return Agents.of({
          locate,
          runtime,
          status: Effect.forEach(AGENT_IDS, statusOf, { concurrency: 2 }),
        });
      })
    );

  /** A fixed runtime, for tests. */
  static readonly layerTest = (runtime: AgentRuntime) =>
    Layer.succeed(
      Agents,
      Agents.of({
        locate: () =>
          Effect.succeed({ _tag: "Missing", reason: "a test" } as Located),
        runtime: Effect.succeed(runtime),
        status: Effect.succeed([]),
      })
    );
}
