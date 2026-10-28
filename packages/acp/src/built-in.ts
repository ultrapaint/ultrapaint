/**
 * The agents that ship built in, each declared once by its descriptor (`built-in/<id>.ts`):
 * how the `ultrapaint` command starts it, the ACP adapter the desktop app bundles in its place,
 * where the agent itself is found and how it says whether it is signed in. The server's launch
 * configurations, the desktop app's agents, its adapters' bundles and its downloads read this
 * list; nothing else in the tool knows which agents ship built in. Another agent is added
 * without code by a JSON file under `~/.ultrapaint/agents/`, which the server reads beside them
 * (`AgentConfigs`).
 *
 * Their ids are contracts' `BuiltInAgentId`, which the desktop's shell bridge names on the wire;
 * the list names exactly those, each under its own id. The releases the desktop app downloads
 * are its own table (`apps/desktop/src/agent-releases.ts`), keyed by the same ids: pinned
 * binaries with their digests, which the server, also built on this package, never fetches.
 */
import type {
  AgentConfig,
  BuiltInAgentId,
} from "@ultrapaint/contracts/threads";
import { claudeCode } from "./built-in/claude-code.ts";
import { codex } from "./built-in/codex.ts";

/** What an agent's own command printed, as the app ran it. */
export interface CommandOutput {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

/** Whether an agent says it is signed in, and how, to end "Signed in …" (`with claude.ai`). */
export interface SignInAnswer {
  readonly how: string | undefined;
  readonly signedIn: boolean;
}

/** Where the desktop app found an agent's executable: its settings, the PATH, its download. */
export type ExecutableSource = "path" | "setting" | "download";

export interface BuiltInAgent<Id extends BuiltInAgentId = BuiltInAgentId> {
  /** The ACP adapter that drives the agent: fetched by `npx`, or bundled into the desktop app. */
  readonly adapter: {
    /** The bundle's name in the app: `<bundle>.mjs` beside the script that starts it. */
    readonly bundle: string;
    /** The file that starts it, in its package. */
    readonly entry: string;
    /** The agent's own native packages, left out of the bundle: the user's, or downloaded. */
    readonly external: readonly string[];
    readonly package: string;
    /** The versions `npx` may run. */
    readonly range: string;
  };
  /** The variable its adapter alone is given a key in, when the agent signs in with one. */
  readonly apiKeyEnv?: string;
  /** Further variables for its adapter in the desktop app, by where the agent was found. */
  readonly env?: Partial<
    Readonly<Record<ExecutableSource, Readonly<Record<string, string>>>>
  >;
  /** The agent itself, which its adapter is told where to find. */
  readonly executable: {
    /** The variable that tells the adapter where the agent is. */
    readonly env: string;
    /** Where to read how to install it. */
    readonly install: string;
    /** Its command, as it is on the PATH. */
    readonly program: string;
  };
  readonly id: Id;
  /** The rest of its launch configuration: what it is told, and what ADR 0013 adds. */
  readonly launch: Pick<
    AgentConfig,
    "authHint" | "env" | "sandboxEnv" | "sandboxMeta" | "stateDirs"
  >;
  readonly name: string;
  readonly signIn: {
    /** A sign-in the app runs through the adapter (ACP `authenticate`): its method, and with what. */
    readonly adapter?: { readonly method: string; readonly with: string };
    /** What the agent's answer to `status` says. */
    readonly parse: (output: CommandOutput) => SignInAnswer;
    /** The arguments that ask the agent whether it is signed in. */
    readonly status: readonly string[];
    /** How the user signs in by themselves: "run `claude` once in a terminal". */
    readonly yourself: string;
  };
}

/** One descriptor for each built-in agent, under its id. */
export type BuiltInAgents = {
  readonly [Id in BuiltInAgentId]: BuiltInAgent<Id>;
};

export const BUILT_IN_AGENTS = {
  [claudeCode.id]: claudeCode,
  [codex.id]: codex,
} as const satisfies BuiltInAgents;

/** A built-in agent's launch configuration: its adapter through `npx`. */
export const launchOf = (agent: BuiltInAgent): AgentConfig => ({
  ...agent.launch,
  args: ["-y", `${agent.adapter.package}@${agent.adapter.range}`],
  builtIn: true,
  command: "npx",
  id: agent.id,
  name: agent.name,
  package: agent.adapter.package,
});

/** The built-in agents' launch configurations, which the server lists before the user's own. */
export const builtInLaunches: readonly AgentConfig[] =
  Object.values(BUILT_IN_AGENTS).map(launchOf);
