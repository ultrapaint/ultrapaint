import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { UltrapaintRpcs } from "@ultrapaint/contracts/rpc";
import { Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { AppLog } from "./app-log.ts";
import { ServerConfig } from "./config.ts";
import { EventBus } from "./events.ts";
import { ProjectManager } from "./project.ts";
import { RpcHandlers } from "./rpc-handlers.ts";
import { SettingsService } from "./services/settings.ts";
import { AgentConfigs } from "./services/threads/agent-configs.ts";
import { Checkpoints } from "./services/threads/checkpoints.ts";
import { ThreadStore } from "./services/threads/thread-store.ts";
import { ThreadService } from "./services/threads/threads.ts";

const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * The editor's API: one WebSocket that carries every RPC and every event stream. The server
 * only listens on loopback, and a browser page from any other origin is turned away before
 * the upgrade; native clients send no origin.
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
        const { origin } = request.headers;
        if (origin && !LOCAL_ORIGIN_RE.test(origin)) {
          return HttpServerResponse.text("origin not allowed", { status: 403 });
        }
        return yield* httpEffect;
      })
    );
    yield* RpcServer.make(UltrapaintRpcs).pipe(
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.forkScoped
    );
  })
).pipe(Layer.provide(RpcHandlers), Layer.provide(RpcSerialization.layerJson));

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
  Effect.map(ServerConfig, ({ port }) =>
    NodeHttpServer.layer(createServer, {
      disablePreemptiveShutdown: true,
      host: "127.0.0.1",
      port,
    })
  )
);

/** Opens the configured project, if there is one, once everything else is up. */
const Boot = Layer.effectDiscard(
  Effect.gen(function* () {
    const { port } = yield* ServerConfig;
    const settings = yield* SettingsService;
    const project = yield* ProjectManager;
    const log = yield* AppLog;
    yield* log.log("server", "info", `listening on http://127.0.0.1:${port}`);
    const saved = yield* settings.get;
    if (saved) {
      yield* Effect.forkScoped(project.open(saved));
    }
  })
);

const Threads = ThreadService.layer.pipe(
  Layer.provideMerge(Checkpoints.layer),
  Layer.provideMerge(Layer.mergeAll(ThreadStore.layer, AgentConfigs.layer))
);

/** Application services. Each is built once and shared by every route. */
const Services = Threads.pipe(
  Layer.provideMerge(ProjectManager.layer),
  Layer.provideMerge(SettingsService.layer),
  Layer.provideMerge(AppLog.layer),
  Layer.provideMerge(EventBus.layer)
);

const Routes = Layer.mergeAll(RpcRoute, HealthRoute, StaticRoute, Boot);

/** Everything but the configuration and the platform: `bin.ts` provides those and launches. */
export const ServerLive = HttpRouter.serve(Routes, {
  disableListenLog: true,
  disableLogger: true,
}).pipe(Layer.provide(Services), Layer.provide(HttpServerLive));
