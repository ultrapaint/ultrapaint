/**
 * The outside agents Settings › Connections connects (ADR 0083, ADR 0144): each one's own
 * registration line, which the editor shows to copy and the server runs on Connect, and whether
 * the agent lists Ultrapaint, as the agent itself answers. Only the built-in agents whose
 * commands are known: a custom agent has none.
 */
import { Schema } from "effect";
import { BuiltInAgentId } from "./threads.ts";

/** The `ultrapaint` command each line registers, which the agent starts for its sessions. */
export const ULTRAPAINT_COMMAND = "ultrapaint";

/** The name every agent lists Ultrapaint's MCP server under. */
const SERVER_NAME = "ultrapaint";

export interface OutsideAgentLine {
  /** The arguments that register Ultrapaint, after the program. */
  readonly add: readonly string[];
  /**
   * The arguments that ask whether the agent lists Ultrapaint: exit 0 when it does, 1 when it
   * does not. `claude mcp get` rather than `claude mcp list`, which starts every server it lists
   * to check it.
   */
  readonly get: readonly string[];
  readonly id: BuiltInAgentId;
  readonly name: string;
  /** The agent's own command, as it is on the PATH. */
  readonly program: string;
}

/**
 * The agents the section lists, in its order. Their names and programs repeat acp's descriptors
 * (`BUILT_IN_AGENTS`), which the editor does not import and which contracts sits below.
 */
export const OUTSIDE_AGENTS: readonly OutsideAgentLine[] = [
  {
    add: [
      "mcp",
      "add",
      SERVER_NAME,
      "-s",
      "user",
      "--",
      ULTRAPAINT_COMMAND,
      "mcp",
    ],
    get: ["mcp", "get", SERVER_NAME],
    id: "claude-code",
    name: "Claude Code",
    program: "claude",
  },
  {
    add: ["mcp", "add", SERVER_NAME, "--", ULTRAPAINT_COMMAND, "mcp"],
    get: ["mcp", "get", SERVER_NAME],
    id: "codex",
    name: "Codex",
    program: "codex",
  },
];

/** The line a row shows, to copy and run by hand: the one Connect runs. */
export const outsideLine = (agent: OutsideAgentLine) =>
  [agent.program, ...agent.add].join(" ");

/**
 * Where an agent stands, as it answers `mcp get`: it lists Ultrapaint, it does not, it is not
 * installed (no program of the person's own on the server's PATH, or only the copy the desktop
 * app downloaded for its threads), or it did not answer in time.
 */
export const OutsideAgentStatus = Schema.Literals([
  "connected",
  "not-connected",
  "not-installed",
  "unanswered",
]);
export type OutsideAgentStatus = typeof OutsideAgentStatus.Type;

export const OutsideAgent = Schema.Struct({
  id: BuiltInAgentId,
  /** Where to read how to install it, when it is not installed. */
  install: Schema.optional(Schema.String),
  /** Why it did not answer, when it did not. */
  message: Schema.optional(Schema.String),
  status: OutsideAgentStatus,
});
export type OutsideAgent = typeof OutsideAgent.Type;

/** The outside agents as Connections opens, and whether the command they would start is there. */
export const OutsideAgents = Schema.Struct({
  agents: Schema.Array(OutsideAgent),
  /** Whether `ultrapaint` is on the PATH of the machine the server runs on. */
  commandOnPath: Schema.Boolean,
});
export type OutsideAgents = typeof OutsideAgents.Type;

/** One agent connected: where it stands now, and whether the command it would start is there. */
export const OutsideAgentConnected = Schema.Struct({
  agent: OutsideAgent,
  commandOnPath: Schema.Boolean,
});
export type OutsideAgentConnected = typeof OutsideAgentConnected.Type;
