import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { NodeHttpServer } from "@effect/platform-node";
import { MAX_FIG_BYTES } from "@ultrapaint/contracts/figma";
import { UltrapaintRpcs } from "@ultrapaint/contracts/rpc";
import {
  CONFIG_FILE_NAME,
  LEGACY_CONFIG_FILE_NAME,
} from "@ultrapaint/contracts/settings";
import { isBusy } from "@ultrapaint/contracts/threads";
import { Deferred, Effect, Layer, Option, Stream } from "effect";
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { AppLog } from "./app-log.ts";
import { AssetRoute } from "./asset-route.ts";
import { ApplicationLayer, ServerAdapters } from "./composition.ts";
import {
  connectHost,
  hostNameOf,
  isAllowedHost,
  isLoopback,
  ServerConfig,
} from "./config.ts";
import { ListenPort } from "./listen-port.ts";
import { OpenProject, ProjectManager } from "./project.ts";
import { RpcHandlers } from "./rpc-handlers.ts";
import { Announce } from "./run-file.ts";
import { FigmaImportService } from "./services/figma-import.ts";
import { McpRoute } from "./services/mcp/route.ts";
import { SettingsService } from "./services/settings.ts";
import { Storage } from "./services/storage.ts";
import { ThreadStore } from "./services/threads/thread-store.ts";

/**
 * Every request names this server by one of its own names. A website the user has open can
 * point its name at this machine (DNS rebinding); its page is then same-origin with whatever it
 * reaches here, so the origin checks below let it through. The `Host` it sends is still its
 * own name, and that is turned away here, before any route sees the request.
 */
const HostGuard = HttpRouter.middleware(
  Effect.map(
    ServerConfig,
    ({ allowedHosts, host, machine }) =>
      (handler) =>
        Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
          const name = hostNameOf(request.headers.host ?? "");
          return name !== undefined &&
            isAllowedHost(name, host, machine.addresses(), allowedHosts)
            ? handler
            : Effect.succeed(
                HttpServerResponse.text("host not allowed", { status: 403 })
              );
        })
  ),
  { global: true }
);

const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** The page came from this server, whatever address it was reached at. */
const sameOrigin = (origin: string, host: string | undefined) =>
  host !== undefined && URL.canParse(origin) && new URL(origin).host === host;

/**
 * Whether a request may be answered: a browser page is let in when it came from this machine or
 * from this server's own address; a native client sends no origin.
 */
const originAllowed = ({
  host,
  origin,
}: Readonly<Record<string, string | undefined>>) =>
  !origin || LOCAL_ORIGIN_RE.test(origin) || sameOrigin(origin, host);

const originRefused = () =>
  HttpServerResponse.text("origin not allowed", { status: 403 });

/**
 * The editor's API: one WebSocket that carries every RPC and every event stream. A browser
 * page is let in when it came from this machine or from this server's own address, and any
 * other origin is turned away before the upgrade; native clients send no origin.
 */
const RpcRoute = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter;
    const { httpEffect, protocol } =
      yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    yield* router.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!originAllowed(request.headers)) {
          return originRefused();
        }
        return yield* httpEffect;
      })
    );
    // By default one defect in a handler is fatal for the whole client: it fails every call in
    // flight and all eight event streams. A defect here is an unexpected I/O error in one
    // request and is reported as that request's failure.
    yield* RpcServer.make(UltrapaintRpcs, { disableFatalDefects: true }).pipe(
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.forkScoped
    );
  })
).pipe(Layer.provide(RpcHandlers), Layer.provide(RpcSerialization.layerJson));

const FIG_HEADER = "x-file-name";

/**
 * A Figma file arrives here, as its bytes: the editor's API is one WebSocket carrying JSON, and
 * a design file runs to tens of megabytes. The reply is the import, as `figma.list` shows it.
 * The same origin rule as the socket: a page from anywhere else on loopback is turned away.
 */
const FigmaImportRoute = HttpRouter.use(
  Effect.fnUntraced(function* (router) {
    const project = yield* OpenProject;
    yield* router.add(
      "POST",
      "/api/figma/import",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!originAllowed(request.headers)) {
          return originRefused();
        }
        const tooLarge = HttpServerResponse.jsonUnsafe(
          { message: "the file is larger than the import accepts" },
          { status: 413 }
        );
        const declared = Number(request.headers["content-length"] ?? 0);
        if (declared > MAX_FIG_BYTES) {
          return tooLarge;
        }
        const name = yield* Effect.option(
          Effect.try(() =>
            decodeURIComponent(request.headers[FIG_HEADER] ?? "design.fig")
          )
        );
        if (Option.isNone(name)) {
          return HttpServerResponse.jsonUnsafe(
            { message: `${FIG_HEADER} is not a URI-encoded file name` },
            { status: 400 }
          );
        }
        // Counted as it arrives: a chunked body declares no length, and is cut off at the cap
        // rather than read whole first.
        const chunks: Uint8Array[] = [];
        let size = 0;
        yield* Stream.runForEachWhile(request.stream, (chunk) =>
          Effect.sync(() => {
            size += chunk.length;
            chunks.push(chunk);
            return size <= MAX_FIG_BYTES;
          })
        );
        if (size > MAX_FIG_BYTES) {
          return tooLarge;
        }
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, at);
          at += chunk.length;
        }
        return yield* project
          .use(
            Effect.flatMap(FigmaImportService, (figma) =>
              figma.create(name.value, bytes)
            )
          )
          .pipe(
            Effect.map((imported) => HttpServerResponse.jsonUnsafe(imported)),
            Effect.catchTag(["BadRequest", "NotConfigured"], (error) =>
              Effect.succeed(
                HttpServerResponse.jsonUnsafe(
                  { message: error.message },
                  { status: 400 }
                )
              )
            )
          );
      })
    );
  })
);

const HealthRoute = HttpRouter.use(
  Effect.fnUntraced(function* (router) {
    const { token, version } = yield* ServerConfig;
    const threads = yield* ThreadStore;
    // The token says which run answers: whoever read a run file checks it against this one.
    // `working` counts the agents at work, for whoever is about to stop the server (the desktop
    // app asks before it does).
    yield* router.add(
      "GET",
      "/api/health",
      Effect.flatMap(threads.list, (all) =>
        HttpServerResponse.json({
          ok: true,
          token,
          version,
          working: all.filter((t) => isBusy(t.status)).length,
        })
      )
    );
  })
);

/** Serves the built editor when `--web-dist` is given; in development Vite does that. */
const StaticRoute = Layer.unwrap(
  Effect.map(ServerConfig, ({ webDist }) =>
    webDist ? HttpStaticServer.layer({ root: webDist, spa: true }) : Layer.empty
  )
);

/**
 * What a connection still open when the server stops has to finish in. By then every request's
 * handler has been interrupted, so this is for what was already written to reach its client and
 * for a WebSocket's closing handshake.
 */
const STOP_GRACE = "100 millis";

/**
 * Closes the server, and once the grace has passed destroys what is still open. Node's `close`
 * waits for every connection to end and drops only those idle between two requests: one a
 * client's pool opened ahead of a request it has not sent yet, or one an upgrade was turned away
 * on whose client keeps its side open, held the stop until the client let go (4 s for fetch's
 * pool) or for ever.
 */
const closeServer = Effect.fnUntraced(function* (
  server: Server,
  open: ReadonlySet<Socket>
) {
  const closed = yield* Deferred.make<void>();
  // The error says the server was not listening, which is closed as well.
  server.close(() => Deferred.doneUnsafe(closed, Effect.void));
  const drained = yield* Effect.timeoutOption(
    Deferred.await(closed),
    STOP_GRACE
  );
  if (Option.isNone(drained)) {
    for (const socket of open) {
      socket.destroy();
    }
    yield* Deferred.await(closed);
  }
});

// The editor holds a WebSocket open for as long as it runs. The default shutdown first waits
// (20 s) for connections to drain, which a live socket never does. Closing the request scopes is
// what ends those sockets, so the wait is skipped, and the server is closed by `closeServer`,
// whose finalizer runs before the layer's own close, which then finds it closed.
const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const { host, port } = yield* ServerConfig;
    const served = Effect.gen(function* () {
      const server = createServer();
      const open = new Set<Socket>();
      server.on("connection", (socket: Socket) => {
        open.add(socket);
        socket.once("close", () => open.delete(socket));
      });
      const http = yield* NodeHttpServer.make(() => server, {
        disablePreemptiveShutdown: true,
        host,
        port,
      });
      yield* Effect.addFinalizer(() => closeServer(server, open));
      return http;
    });
    return Layer.mergeAll(
      Layer.effect(HttpServer.HttpServer, served),
      NodeHttpServer.layerHttpServices
    );
  })
);

/** Once the port is open, the port it is: the one asked for, or the one the system gave for 0. */
const Listening = Layer.effectDiscard(
  Effect.gen(function* () {
    const { address } = yield* HttpServer.HttpServer;
    const listen = yield* ListenPort;
    yield* listen.listening("port" in address ? address.port : 0);
  })
).pipe(Layer.provideMerge(HttpServerLive));

/**
 * Opens the configured project, if there is one, once everything else is up. An unsaved session
 * started inside a repository opens it with what detection finds there, when that is enough to
 * run: nothing has to be configured to look at a repository that already holds its pages. From
 * then on `ProjectManager` follows the configuration file.
 */
const Boot = Layer.effectDiscard(
  Effect.gen(function* () {
    const { host } = yield* ServerConfig;
    const port = yield* (yield* ListenPort).get;
    const settings = yield* SettingsService;
    const project = yield* ProjectManager;
    const log = yield* AppLog;
    yield* log.log(
      "server",
      "info",
      `listening on http://${connectHost(host)}:${port}`
    );
    if (!isLoopback(host)) {
      yield* log.log(
        "server",
        "warn",
        `listening on ${host}: whoever reaches this port can run agents in the repository with your rights; keep it to a private network`
      );
    }
    const storage = yield* (yield* Storage).info;
    if (storage.mode === "ephemeral") {
      yield* log.log(
        "server",
        "warn",
        storage.session
          ? "started without a configuration: settings and agent threads are kept until the command stops"
          : "started without a configuration: settings and agent threads are not saved"
      );
    } else {
      yield* log.log("server", "info", `configuration: ${storage.configPath}`);
      if (storage.configPath?.endsWith(`/${LEGACY_CONFIG_FILE_NAME}`)) {
        yield* log.log(
          "server",
          "warn",
          `${LEGACY_CONFIG_FILE_NAME} is the old name of the configuration file: rename it to ${CONFIG_FILE_NAME} (Settings does it for you)`
        );
      }
    }
    const saved = yield* settings.get;
    const repo =
      storage.mode === "ephemeral" ? storage.defaultRepoPath : undefined;
    if (saved) {
      yield* Effect.forkScoped(project.apply(saved, "the saved settings"));
    } else if (repo) {
      yield* Effect.forkScoped(project.adoptDetected(repo));
    }
  })
);

const Routes = Layer.mergeAll(
  HostGuard,
  RpcRoute,
  HealthRoute,
  FigmaImportRoute,
  AssetRoute,
  McpRoute,
  StaticRoute,
  Boot
);

/**
 * Everything but the configuration and the platform: `bin.ts` provides those and launches.
 *
 * The services are built before the port is opened. The HTTP server listens as soon as its
 * layer is built and only answers once `serve` has attached the handler; a request accepted in
 * between is dropped by Node and its client waits forever. Built the other way round, that gap
 * was the whole start of the services, and the command's health check fell into it.
 */
const Served = HttpRouter.serve(Routes, {
  disableListenLog: true,
  disableLogger: true,
}).pipe(
  Layer.provideMerge(Listening),
  Layer.provideMerge(ApplicationLayer(ServerAdapters))
);

/** And once it all answers, the run file and the ready line say so (PLAN-desktop D5). */
export const ServerLive = Announce.pipe(Layer.provide(Served));
