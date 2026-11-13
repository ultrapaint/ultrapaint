import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRuntime } from "@ultrapaint/acp/runtime";
import { Context, Effect, Layer, Option } from "effect";

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
/**
 * The addresses of the machine's network interfaces, as `os.networkInterfaces` reads them, or none
 * where they cannot be read: a service barred from netlink sockets, as mcp-hub's unit is
 * (`RestrictAddressFamilies`), is answered with an error for asking. Loopback is allowed without
 * them, and only a server listening on every interface needs them.
 */
export const interfaceAddresses = (
  read: () => Readonly<
    Record<string, readonly { readonly address: string }[] | undefined>
  >
): readonly string[] =>
  Option.match(Option.liftThrowable(read)(), {
    onNone: () => [],
    onSome: (interfaces) =>
      Object.values(interfaces).flatMap((nets) =>
        (nets ?? []).map((net) => net.address)
      ),
  });

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
     * pages route, what the Library holds. On unless a measurement wants it off.
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
      /**
       * The environment the server was started in, without what only the server is given (the
       * desktop's agent runtime, Electron's switch to Node): what an agent, and a command it asks
       * the editor to run, start from under their own variables.
       */
      readonly env: Readonly<Record<string, string>>;
      readonly home: string;
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
    /**
     * The port the editor is reached on when another process serves it on this host (Vite,
     * under `ultrapaint --dev`): the run file and the ready line name it rather than the
     * server's own, so that whoever attaches lands on the editor. The server's port otherwise.
     */
    readonly editorPort: number | undefined;
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
     * it. Not a secret and not a credential: the server has no authentication. `ultrapaint
     * --dev` gives one for its whole session (`--token`), which the server's restarts keep.
     */
    readonly token: string;
    /**
     * The person's folder, absolute: their name, findings, chat preferences and custom agents,
     * the same in every project. `~/.ultrapaint`, or `.ultrapaint` in `--user-dir` (ADR 0091).
     */
    readonly userDir: string;
    readonly version: string;
    /** Built web bundle to serve, when running outside the Vite dev server. */
    readonly webDist: string | undefined;
  }
>()("ultrapaint/server/ServerConfig") {
  /**
   * A configuration for a test: loopback on port 0, nothing saved (an unsaved session), no
   * discovery, briefing or MCP server, the system's temporary directory for the home, and a
   * user directory of its own that goes with the layer. What a test cares about it says in
   * `overrides`; `machine` is merged with the default one, so a test names only the fields it
   * needs (its own home, the `PATH`).
   */
  static readonly layerTest = (
    overrides: Partial<Omit<ServerConfig["Service"], "machine">> & {
      readonly machine?: Partial<ServerConfig["Service"]["machine"]>;
    } = {}
  ) => {
    const { machine, userDir, ...rest } = overrides;
    const config = (dir: string) =>
      ServerConfig.of({
        allowedHosts: [],
        briefing: false,
        cwd: tmpdir(),
        discovery: false,
        editorPort: undefined,
        host: "127.0.0.1",
        mcp: false,
        port: 0,
        readyJson: false,
        storage: { mode: "ephemeral" },
        token: "test",
        userDir: dir,
        version: "test",
        webDist: undefined,
        ...rest,
        machine: {
          addresses: () => [],
          env: {},
          home: tmpdir(),
          path: "",
          tmpdir: tmpdir(),
          uid: process.getuid?.(),
          ...machine,
        },
      });
    if (userDir !== undefined) {
      return Layer.succeed(ServerConfig, config(userDir));
    }
    // Its own, so that what one test keeps there (the chat's preferences) no other reads.
    return Layer.effect(
      ServerConfig,
      Effect.map(
        Effect.acquireRelease(
          Effect.sync(() => mkdtempSync(join(tmpdir(), "ultrapaint-user-"))),
          (dir) =>
            Effect.sync(() => rmSync(dir, { force: true, recursive: true }))
        ),
        config
      )
    );
  };
}
