import type { AgentRuntime } from "@ultrapaint/acp/runtime";
import { Context } from "effect";

/**
 * Where settings and tool state go, decided once at startup.
 * - `managed`: `--home <dir>`, as `pnpm dev` passes it. `settings.json` and all state live in `home`.
 * - `file`: a configuration file in (or near) the repository; state sits in `stateDir`.
 * - `ephemeral`: no configuration was given or found. Nothing is written outside a temporary
 *   directory that goes away with the process, until the user saves a configuration. The
 *   `ultrapaint` command lends a `sessionDir` that outlives the server, so a restart under
 *   `--dev` keeps the session; the command removes it when it exits.
 */
export type StorageTarget =
  | { readonly mode: "managed"; readonly home: string }
  | {
      readonly mode: "file";
      readonly configPath: string;
      readonly stateDir: string;
    }
  | { readonly mode: "ephemeral"; readonly sessionDir?: string };

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

/** A `Host` header: a name or an address, a bracketed IPv6 address, and maybe a port. */
const HOST_RE = /^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d+)?$/i;

/** The host name in a `Host` header, as a URL spells it; nothing for anything else. */
export const hostNameOf = (host: string): string | undefined =>
  HOST_RE.test(host) && URL.canParse(`http://${host}`)
    ? new URL(`http://${host}`).hostname
    : undefined;

const LOOPBACK_ADDRESSES = ["localhost", "127.0.0.1", "::1"];

/**
 * Whether a request may address a server bound to `host` by `name`, the host name of its `Host`
 * header. A page from a website can make its own name resolve to this machine (DNS rebinding),
 * and then its origin and the `Host` it sends agree; what it cannot do is send one of these.
 * Loopback always; bound to one address, that address; bound to every interface, every address
 * of the machine and its names. Beyond those, the names the user allowed (`--allowed-host`), for
 * a proxy or a name the machine has elsewhere: a name with a leading dot allows its subdomains.
 */
export const isAllowedHost = (
  name: string,
  host: string,
  addresses: readonly string[],
  allowed: readonly string[] = []
): boolean => {
  const own = WILDCARDS.has(host) ? addresses : [host];
  const exact = [...LOOPBACK_ADDRESSES, ...own, ...allowed].flatMap(
    (n) => hostNameOf(n.includes(":") ? `[${n}]` : n) ?? []
  );
  return (
    exact.includes(name) ||
    allowed.some(
      (n) =>
        n.startsWith(".") &&
        (name.endsWith(n.toLowerCase()) || name === n.slice(1).toLowerCase())
    )
  );
};

/** Resolved once in `bin.ts` from flags and environment; nothing deeper reads `process.env`. */
export class ServerConfig extends Context.Service<
  ServerConfig,
  {
    /**
     * The adapters the desktop app brings for the built-in agents, run on its own binary, in
     * place of `npx` (ADR 0031); none for the command.
     */
    readonly agentRuntime?: AgentRuntime | undefined;
    /**
     * Whether a session's first prompt carries the project briefing: where the designs live, how
     * pages route, what the Assets panel holds. On unless a measurement wants it off.
     */
    readonly briefing: boolean;
    /**
     * What this machine is: the home directory a confined agent is kept out of, the `PATH` its
     * toolchain is found on, and the names the server answers to.
     */
    readonly machine: {
      /**
       * This machine's network addresses and its names, as they are now: a server bound to
       * every interface is reached by any of them, and a request naming anything else is turned
       * away. Asked on every request, since an address comes and goes with a network.
       */
      readonly addresses: () => readonly string[];
      readonly home: string;
      /**
       * The Node the preview runs on: the one running the server, or, where that is Electron's
       * own binary run as Node (the desktop app), the user's `node` on the `PATH` (D7).
       */
      readonly node: string;
      readonly path: string;
      /** The system's temporary directory, as `os.tmpdir()` says. */
      readonly tmpdir: string;
      /** The user's id; none on a platform without them. */
      readonly uid: number | undefined;
    };
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
    /**
     * Further names a request may address the server by: a reverse proxy's, or a name the
     * machine has on a network of its own (`--allowed-host`, given once per name).
     */
    readonly allowedHosts: readonly string[];
    /** Whether agents are given the editor's own MCP server to call. */
    readonly mcp: boolean;
    /** The port asked for; with 0 the system picks one, which `ListenPort` says once known. */
    readonly port: number;
    /**
     * Whether the server says it is ready as one line of JSON on stdout, `{ url, port, token,
     * pid }`, once it listens; its logs then go to stderr. For whatever started it: the desktop
     * app, or a command over SSH (`--ready-json`).
     */
    readonly readyJson: boolean;
    readonly storage: StorageTarget;
    /**
     * This run's id, random: the run file, the ready line and `/api/health` carry it, so that
     * whoever finds a run file can tell the server answering on its port is the one that wrote
     * it. Not a secret and not a credential: the server has no authentication.
     */
    readonly token: string;
    /** User-level data that is only read, such as custom agents: `~/.ultrapaint`. */
    readonly userDir: string;
    readonly version: string;
    /** Built web bundle to serve, when running outside the Vite dev server. */
    readonly webDist: string | undefined;
  }
>()("ultrapaint/server/ServerConfig") {}
