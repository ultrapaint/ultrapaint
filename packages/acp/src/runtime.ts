/**
 * The agent runtime the desktop app brings (PLAN-desktop D8, ADR 0031): the built-in agents'
 * ACP adapters bundled into the app, run on Electron's own binary as Node, instead of fetched
 * with `npx`. The agent each adapter drives (the Claude Code or Codex binary) is the user's, or
 * one the app downloaded, and is named to the adapter in its variables. The `ultrapaint`
 * command has no runtime and keeps `npx`.
 *
 * Pure: the server is handed a runtime at start (`bin.ts`) and turns launch configurations into
 * launches with it.
 */
import type { AgentConfig } from "@ultrapaint/contracts/threads";
import { Schema } from "effect";

export const RuntimeAgent = Schema.Struct({
  /** The adapter, bundled into one file. */
  adapter: Schema.String,
  /**
   * What the adapter is told: the agent's executable (`CLAUDE_CODE_EXECUTABLE`, `CODEX_PATH`)
   * and the key it signs in with, when the user gave one.
   */
  env: Schema.Record(Schema.String, Schema.String),
  /** Said in place of the configuration's hint when the agent cannot start: how to install it. */
  hint: Schema.optional(Schema.String),
});
export type RuntimeAgent = typeof RuntimeAgent.Type;

export const AgentRuntime = Schema.Struct({
  /** The built-in agents it runs, by id; any other keeps its own launch. */
  agents: Schema.Record(Schema.String, RuntimeAgent),
  /** The executable that runs the adapters: Electron's own binary, as Node. */
  node: Schema.String,
  /**
   * What an agent in the sandbox has to read and run, wherever it is: Electron, the adapters,
   * the agents downloaded into the app's data.
   */
  reads: Schema.Array(Schema.String),
  /**
   * The script that starts an adapter: it takes `ELECTRON_RUN_AS_NODE` away and imports the
   * adapter named after it. The variable makes Electron's binary Node, and is needed to start
   * the adapter; the agent and its shell commands, which the adapter starts in turn, must not
   * have it, or a `node` they run that is Electron would not be Node.
   */
  wrapper: Schema.String,
});
export type AgentRuntime = typeof AgentRuntime.Type;

/** The runtime as the desktop app hands it to the server, in `ULTRAPAINT_AGENT_RUNTIME`. */
export const AgentRuntimeJson = Schema.fromJsonString(AgentRuntime);

/** A built-in agent's launch with the runtime's adapter in place of `npx`. */
export const withRuntime = (
  config: AgentConfig,
  runtime: AgentRuntime | undefined
): AgentConfig => {
  const agent = config.builtIn ? runtime?.agents[config.id] : undefined;
  if (!(runtime && agent)) {
    return config;
  }
  return {
    ...config,
    args: [runtime.wrapper, agent.adapter],
    command: runtime.node,
    env: { ...config.env, ...agent.env, ELECTRON_RUN_AS_NODE: "1" },
    ...(agent.hint === undefined ? {} : { authHint: agent.hint }),
  };
};
