import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { MAX_FIG_BYTES } from "@ultrapaint/contracts/figma";
import { UltrapaintRpcs } from "@ultrapaint/contracts/rpc";
import { Effect, Layer, Stream } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { AppLog } from "./app-log.ts";
import { connectHost, isLoopback, ServerConfig } from "./config.ts";
import { EventBus } from "./events.ts";
import { ProjectManager } from "./project.ts";
import { RpcHandlers } from "./rpc-handlers.ts";
import { FigmaImportService } from "./services/figma-import.ts";
import { McpAccess } from "./services/mcp/access.ts";
import { McpRoute } from "./services/mcp/route.ts";
import { Screenshots } from "./services/screenshots.ts";
import { SettingsService } from "./services/settings.ts";
import { SetupService } from "./services/setup.ts";
import { Storage } from "./services/storage.ts";
import { AgentConfigs } from "./services/threads/agent-configs.ts";
import { AgentDiscovery } from "./services/threads/agent-discovery.ts";
import { AgentSandbox } from "./services/threads/agent-sandbox.ts";
import { ProjectBriefing } from "./services/threads/briefing.ts";
import { ChatPreferences } from "./services/threads/chat-preferences.ts";
import { Checkpoints } from "./services/threads/checkpoints.ts";
import { SlashCommands } from "./services/threads/commands.ts";
import { ThreadStore } from "./services/threads/thread-store.ts";
import { ThreadService } from "./services/threads/threads.ts";

const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** The page came from this server, whatever address it was reached at. */
const sameOrigin = (origin: string, host: string | undefined) =>
  host !== undefined && URL.canParse(origin) && new URL(origin).host === host;

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
        const { host, origin } = request.headers;
        if (
          origin &&
          !LOCAL_ORIGIN_RE.test(origin) &&
          !sameOrigin(origin, host)
        ) {
          return HttpServerResponse.text("origin not allowed", { status: 403 });
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
    const project = yield* ProjectManager;
    yield* router.add(
      "POST",
      "/api/figma/import",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { host, origin } = request.headers;
        if (
          origin &&
          !LOCAL_ORIGIN_RE.test(origin) &&
          !sameOrigin(origin, host)
        ) {
          return HttpServerResponse.text("origin not allowed", { status: 403 });
        }
        const declared = Number(request.headers["content-length"] ?? 0);
        if (declared > MAX_FIG_BYTES) {
          return HttpServerResponse.jsonUnsafe(
            { message: "the file is larger than the import accepts" },
            { status: 413 }
          );
        }
        const name = decodeURIComponent(
          request.headers[FIG_HEADER] ?? "design.fig"
        );
        const bytes = new Uint8Array(yield* request.arrayBuffer);
        return yield* project
          .use(
            Effect.flatMap(FigmaImportService, (figma) =>
              figma.create(name, bytes)
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
    const { version } = yield* ServerConfig;
    yield* router.add(
      "GET",
      "/api/health",
      HttpServerResponse.json({ ok: true, version })
    );
  })
);

/** Serves the built editor when `--web-dist` is given; in development Vite does that. */
const StaticRoute = Layer.unwrap(
  Effect.map(ServerConfig, ({ webDist }) =>
    webDist ? HttpStaticServer.layer({ root: webDist, spa: true }) : Layer.empty
  )
);

// The editor holds a WebSocket open for as long as it runs. The default shutdown first waits
// (20 s) for connections to drain, which a live socket never does. Closing the request scopes is
// what ends those sockets, so the wait is skipped.
const HttpServerLive = Layer.unwrap(
  Effect.map(ServerConfig, ({ host, port }) =>
    NodeHttpServer.layer(createServer, {
      disablePreemptiveShutdown: true,
      host,
      port,
    })
  )
);

/** Opens the configured project, if there is one, once everything else is up. */
const Boot = Layer.effectDiscard(
  Effect.gen(function* () {
    const { host, port } = yield* ServerConfig;
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
        "started without a configuration: settings and agent threads are not saved"
      );
    } else {
      yield* log.log("server", "info", `configuration: ${storage.configPath}`);
    }
    const saved = yield* settings.get;
    if (saved) {
      yield* Effect.forkScoped(project.open(saved));
    }
    // The configuration file changed under us (an editor, a branch switch): follow it.
    yield* settings.changes.pipe(
      Stream.runForEach((next) => project.open(next)),
      Effect.forkScoped
    );
  })
);

const Threads = ThreadService.layer.pipe(
  Layer.provideMerge(Checkpoints.layer),
  Layer.provideMerge(AgentDiscovery.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      ThreadStore.layer,
      AgentConfigs.layer,
      ChatPreferences.layer,
      // The briefing says what the sandbox allows, so it is built on it.
      ProjectBriefing.layer.pipe(Layer.provideMerge(AgentSandbox.layer)),
      McpAccess.layer,
      SlashCommands.layer
    )
  )
);

/** Application services. Each is built once and shared by every route. */
const Services = Threads.pipe(
  Layer.provideMerge(ProjectManager.layer),
  Layer.provideMerge(Screenshots.layer),
  Layer.provideMerge(SettingsService.layer),
  Layer.provideMerge(SetupService.layer),
  Layer.provideMerge(Storage.layer),
  Layer.provideMerge(AppLog.layer),
  Layer.provideMerge(EventBus.layer)
);

const Routes = Layer.mergeAll(
  RpcRoute,
  HealthRoute,
  FigmaImportRoute,
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
export const ServerLive = HttpRouter.serve(Routes, {
  disableListenLog: true,
  disableLogger: true,
}).pipe(Layer.provide(HttpServerLive), Layer.provide(Services));
