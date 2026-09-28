import { Context } from "effect";

/**
 * Where settings and tool state go, decided once at startup.
 * - `managed`: `--home <dir>`, as `pnpm dev` passes it. `settings.json` and all state live in `home`.
 * - `file`: a configuration file in (or near) the repository; state sits in `stateDir`.
 * - `ephemeral`: no configuration was given or found. Nothing is written outside a temporary
 *   directory that goes away with the process, until the user saves a configuration.
 */
export type StorageTarget =
  | { readonly mode: "managed"; readonly home: string }
  | {
      readonly mode: "file";
      readonly configPath: string;
      readonly stateDir: string;
    }
  | { readonly mode: "ephemeral" };

/** `0.0.0.0` and `::` bind every interface; they are not addresses a client connects to. */
const WILDCARDS = new Set(["0.0.0.0", "::"]);

/** The address in a URL a client on this machine reaches a server bound to `host` at. */
export const connectHost = (host: string): string => {
  if (WILDCARDS.has(host)) {
    return "127.0.0.1";
  }
  return host.includes(":") ? `[${host}]` : host;
};

/** Whether `host` keeps the server to this machine. */
export const isLoopback = (host: string): boolean =>
  host === "127.0.0.1" || host === "localhost" || host === "::1";

/** Resolved once in `bin.ts` from flags and environment; nothing deeper reads `process.env`. */
export class ServerConfig extends Context.Service<
  ServerConfig,
  {
    /**
     * Whether a session's first prompt carries the project briefing: where the designs live, how
     * pages route, what the palette is. On unless a measurement wants it off.
     */
    readonly briefing: boolean;
    /**
     * What confining an agent needs to know about this machine: the home directory it keeps
     * closed, and the `PATH` its toolchain is found on.
     */
    readonly machine: { readonly home: string; readonly path: string };
    /** Directory the server was started from; the first-run setup proposes its repository. */
    readonly cwd: string;
    /**
     * Whether each agent is started once, with no prompt, to learn the models it offers before
     * a thread needs them. Off where agents must not start on their own: tests, measurements.
     */
    readonly discovery: boolean;
    /**
     * Address the server listens on: loopback unless the editor is to be reached from another
     * machine, over a private network.
     */
    readonly host: string;
    /** Whether agents are given the editor's own MCP server to call. */
    readonly mcp: boolean;
    readonly port: number;
    readonly storage: StorageTarget;
    /** User-level data that is only read, such as custom agents: `~/.ultrapaint`. */
    readonly userDir: string;
    readonly version: string;
    /** Built web bundle to serve, when running outside the Vite dev server. */
    readonly webDist: string | undefined;
  }
>()("ultrapaint/server/ServerConfig") {}
