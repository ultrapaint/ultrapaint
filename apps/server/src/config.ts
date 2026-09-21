import { Context } from "effect";

/**
 * Where settings and tool state go, decided once at startup.
 * - `managed`: the desktop app. `settings.json` and all state live in `home`.
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

/** Resolved once in `bin.ts` from flags and environment; nothing deeper reads `process.env`. */
export class ServerConfig extends Context.Service<
  ServerConfig,
  {
    /**
     * Whether a session's first prompt carries the project briefing: where the designs live, how
     * pages route, what the palette is. On unless a measurement wants it off.
     */
    readonly briefing: boolean;
    /** Directory the server was started from; the first-run setup proposes its repository. */
    readonly cwd: string;
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
