import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { homedir, hostname, networkInterfaces, tmpdir } from "node:os";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Console, Effect, Layer, Logger, Option } from "effect";
import { Command, Flag } from "effect/cli";
import product from "../../../package.json" with { type: "json" };
import { ServerConfig, type StorageTarget } from "./config.ts";
import { liveRun } from "./run-file.ts";
import { ServerLive } from "./server.ts";
import { resolveStorage } from "./storage-resolve.ts";

/** The release workflow bumps it in the root `package.json`; the bundle carries it. */
const VERSION = product.version;

/** The state directory a storage target has before the server starts, if it has one. */
const stateDirOf = (storage: StorageTarget): string | undefined => {
  if (storage.mode === "managed") {
    return storage.home;
  }
  return storage.mode === "file" ? storage.stateDir : storage.sessionDir;
};

/** A port nothing listens on now, on the address the server is to bind. */
const freePort = (host: string) =>
  Effect.callback<number>((resume) => {
    const probe = createServer();
    probe.once("error", () => resume(Effect.succeed(0)));
    probe.listen(0, host, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resume(Effect.succeed(port)));
    });
  });

const serve = Command.make(
  "ultrapaint",
  {
    allowedHost: Flag.String("allowed-host").pipe(
      Flag.withDescription(
        "A further name the editor may be reached by, such as a reverse proxy's or a VPN's; .example.com allows its subdomains (repeatable)"
      ),
      Flag.atLeast(0)
    ),
    config: Flag.String("config").pipe(
      Flag.withDescription(
        "Configuration file (default: the nearest ultrapaint.config.json, or ultrapaint.json, from the working directory up)"
      ),
      Flag.withFallbackConfig(Config.String("ULTRAPAINT_CONFIG")),
      Flag.optional
    ),
    ephemeral: Flag.Boolean("ephemeral").pipe(
      Flag.withDescription(
        "Save nothing, even when a configuration file exists"
      ),
      Flag.withDefault(false)
    ),
    home: Flag.String("home").pipe(
      Flag.withDescription(
        "Directory that keeps settings and state across runs, wherever the command is started"
      ),
      Flag.withFallbackConfig(Config.String("ULTRAPAINT_HOME")),
      Flag.optional
    ),
    host: Flag.String("host").pipe(
      Flag.withDescription(
        "Address to listen on: 127.0.0.1 keeps the editor to this machine; the machine's address on a private network, or 0.0.0.0 for every interface, reaches it from another"
      ),
      Flag.withFallbackConfig(Config.String("ULTRAPAINT_HOST")),
      Flag.withDefault("127.0.0.1")
    ),
    noBriefing: Flag.Boolean("no-briefing").pipe(
      Flag.withDescription(
        "Do not tell agents about the project before their first prompt"
      ),
      Flag.withDefault(false)
    ),
    noDiscovery: Flag.Boolean("no-discovery").pipe(
      Flag.withDescription(
        "Do not start agents at launch to list their models; they are listed once one has run"
      ),
      Flag.withDefault(false)
    ),
    noMcp: Flag.Boolean("no-mcp").pipe(
      Flag.withDescription("Do not offer agents the editor's own MCP server"),
      Flag.withDefault(false)
    ),
    port: Flag.Int("port").pipe(
      Flag.withDescription("Port to listen on; 0 picks a free one"),
      Flag.withFallbackConfig(Config.Int("ULTRAPAINT_PORT")),
      Flag.withDefault(4770)
    ),
    readyJson: Flag.Boolean("ready-json").pipe(
      Flag.withDescription(
        "Once listening, print one line of JSON on stdout with the URL, port, token and pid, and log to stderr; a server already running for the project prints its own line"
      ),
      Flag.withDefault(false)
    ),
    sessionDir: Flag.String("session-dir").pipe(
      Flag.withDescription(
        "Directory an unsaved session keeps its settings and state in, so they survive a restart; the caller removes it"
      ),
      Flag.withFallbackConfig(Config.String("ULTRAPAINT_SESSION_DIR")),
      Flag.optional
    ),
    webDist: Flag.String("web-dist").pipe(
      Flag.withDescription("Built editor bundle to serve"),
      Flag.withFallbackConfig(Config.String("ULTRAPAINT_WEB_DIST")),
      Flag.optional
    ),
  },
  Effect.fn(function* ({
    allowedHost,
    config,
    ephemeral,
    home,
    host,
    noBriefing,
    noDiscovery,
    noMcp,
    port,
    readyJson,
    sessionDir,
    webDist,
  }) {
    const cwd = process.cwd();
    // The password database answers when the environment has no HOME (or an empty one).
    const userHome = process.env.HOME || homedir();
    const { storage, userDir } = yield* resolveStorage({
      config: Option.getOrUndefined(config),
      cwd,
      ephemeral,
      home: Option.getOrUndefined(home),
      sessionDir: Option.getOrUndefined(sessionDir),
      userHome,
    });
    // A project's server runs once: a second start finds the first by its run file in the
    // state directory, says where it is, and leaves it be (PLAN-desktop D5). An unsaved session
    // has no state directory to find before it starts.
    const known = stateDirOf(storage);
    const running = known ? yield* liveRun(known) : Option.none();
    if (Option.isSome(running)) {
      // For people on stderr, so that stdout keeps to the ready line when one is asked for.
      yield* Console.error(
        `ultrapaint is running already for this project: ${running.value.url}`
      );
      if (readyJson) {
        yield* Console.log(JSON.stringify(running.value));
      }
      return;
    }
    const resolved = ServerConfig.of({
      allowedHosts: allowedHost,
      briefing: !noBriefing,
      cwd,
      discovery: !noDiscovery,
      host,
      machine: {
        // Read on every request: a network joined since the start brings an address.
        addresses: () => [
          ...Object.values(networkInterfaces()).flatMap((nets) =>
            (nets ?? []).map((net) => net.address)
          ),
          hostname(),
          // The name mDNS gives the machine on the local network.
          `${hostname()}.local`,
        ],
        home: userHome,
        path: process.env.PATH ?? "",
        tmpdir: tmpdir(),
        uid: process.getuid?.(),
      },
      mcp: !noMcp,
      port: port === 0 ? yield* freePort(host) : port,
      readyJson,
      storage,
      token: randomBytes(16).toString("hex"),
      userDir,
      version: VERSION,
      webDist: Option.getOrUndefined(webDist),
    });
    return yield* Layer.launch(
      ServerLive.pipe(Layer.provide(Layer.succeed(ServerConfig, resolved)))
    ).pipe(
      // With the ready line on stdout, stdout carries nothing else.
      Effect.provideService(Logger.LogToStderr, readyJson)
    );
  })
).pipe(Command.withDescription("Local backend of the ultrapaint editor"));

serve.pipe(
  Command.run({ version: VERSION }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
);
