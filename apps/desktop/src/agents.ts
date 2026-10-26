/**
 * The built-in agents as the app runs them (PLAN-desktop D8): their ACP adapters bundled into
 * the app and started on Electron's own binary, each told where its agent is. The servers the app
 * starts are handed this as their agent runtime (`ULTRAPAINT_AGENT_RUNTIME`), asked again at
 * each start, so a change applies to the next project opened.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import type { AgentRuntime, RuntimeAgent } from "@ultrapaint/acp/runtime";
import { Context, Effect, Layer, Option } from "effect";
import { LoginShell } from "./login-shell.ts";
import { findExecutable } from "./which.ts";

/** The built-in agents the app brings an adapter for. */
export const AGENTS = {
  "claude-code": {
    adapter: "claude-agent-acp.mjs",
    /** claude-agent-acp's `claudeCliPath()` takes it before its own SDK's binary. */
    executableEnv: "CLAUDE_CODE_EXECUTABLE",
    install: "https://code.claude.com/docs/en/setup",
    name: "Claude Code",
    program: "claude",
  },
  codex: {
    adapter: "codex-acp.mjs",
    /** codex-acp runs it in place of the `@openai/codex` it depends on. */
    executableEnv: "CODEX_PATH",
    install: "https://developers.openai.com/codex/cli",
    name: "Codex",
    program: "codex",
  },
} as const;
export type AgentId = keyof typeof AGENTS;
export const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

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

export class Agents extends Context.Service<
  Agents,
  {
    /** The runtime for the next server the app starts. */
    readonly runtime: Effect.Effect<AgentRuntime>;
  }
>()("ultrapaint/desktop/Agents") {
  static readonly layer = (layout: AppLayout) =>
    Layer.effect(
      Agents,
      Effect.gen(function* () {
        const { env } = yield* LoginShell;
        const searchPath = env.PATH ?? "";
        const runtime = Effect.gen(function* () {
          const found: Partial<Record<AgentId, FoundAgent>> = {};
          const hints: Partial<Record<AgentId, string>> = {};
          for (const id of AGENT_IDS) {
            const agent = AGENTS[id];
            const executable = yield* findExecutable(agent.program, searchPath);
            if (Option.isSome(executable)) {
              found[id] = { executable: executable.value };
            } else {
              hints[id] =
                `${agent.name} is not installed: \`${agent.program}\` is not on your PATH. Install it (${agent.install}), then restart Ultrapaint.`;
            }
          }
          return makeRuntime(layout, found, hints);
        });
        return Agents.of({ runtime });
      })
    );

  /** A fixed runtime, for tests. */
  static readonly layerTest = (runtime: AgentRuntime) =>
    Layer.succeed(Agents, Agents.of({ runtime: Effect.succeed(runtime) }));
}
