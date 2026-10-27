import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { MAX_FIG_BYTES } from "@ultrapaint/contracts/figma";
import { UltrapaintRpcs } from "@ultrapaint/contracts/rpc";
import {
  CONFIG_FILE_NAME,
  defaultSettings,
  LEGACY_CONFIG_FILE_NAME,
} from "@ultrapaint/contracts/settings";
import { applySuggestions } from "@ultrapaint/contracts/setup";
import { isBusy } from "@ultrapaint/contracts/threads";
import { Effect, Layer, Option, Stream } from "effect";
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { AppLog } from "./app-log.ts";
import {
  connectHost,
  hostNameOf,
  isAllowedHost,
  isLoopback,
  ServerConfig,
} from "./config.ts";
import { EventBus } from "./events.ts";
import { ListenPort } from "./listen-port.ts";
import { PreviewProxy } from "./preview-proxy.ts";
import { ProjectManager } from "./project.ts";
import { RpcHandlers } from "./rpc-handlers.ts";
import { Announce } from "./run-file.ts";
import { DesignSystemSetupService } from "./services/design-system-setup.ts";
import { DesignSystemSyncService } from "./services/design-system-sync.ts";
import { FigmaImportService } from "./services/figma-import.ts";
import { McpAccess } from "./services/mcp/access.ts";
import { McpRoute } from "./services/mcp/route.ts";
import { ProfileService } from "./services/profile.ts";
import { Screenshots } from "./services/screenshots.ts";
import { SettingsService } from "./services/settings.ts";
import { SetupService } from "./services/setup.ts";
import { SnapshotStore } from "./services/snapshot-store.ts";
import { Snapshots } from "./services/snapshots.ts";
import { Storage } from "./services/storage.ts";
import { AgentConfigs } from "./services/threads/agent-configs.ts";
import { AgentDiscovery } from "./services/threads/agent-discovery.ts";
import { AgentLauncher } from "./services/threads/agent-launcher.ts";
import { AgentSandbox } from "./services/threads/agent-sandbox.ts";
import { ProjectBriefing } from "./services/threads/briefing.ts";
import { ChatPreferences } from "./services/threads/chat-preferences.ts";
import { Checkpoints } from "./services/threads/checkpoints.ts";
import { SlashCommands } from "./services/threads/commands.ts";
import { ThreadSessions } from "./services/threads/thread-session.ts";
import { ThreadStore } from "./services/threads/thread-store.ts";
import { ThreadService } from "./services/threads/threads.ts";

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

// The editor holds a WebSocket open for as long as it runs. The default shutdown first waits
// (20 s) for connections to drain, which a live socket never does. Closing the request scopes is
// what ends those sockets, so the wait is skipped.
// `/preview/` goes to the open project's preview server before the router sees it (ADR 0034).
const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const { host, port } = yield* ServerConfig;
    const proxy = yield* PreviewProxy;
    return NodeHttpServer.layer(
      () => {
        const server = createServer();
        proxy.attach(server);
        return server;
      },
      {
        disablePreemptiveShutdown: true,
        host,
        port,
      }
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
 * run: nothing has to be configured to look at a repository that already holds its pages.
 */
const Boot = Layer.effectDiscard(
  Effect.gen(function* () {
    const { host } = yield* ServerConfig;
    const port = yield* (yield* ListenPort).get;
    const settings = yield* SettingsService;
    const setup = yield* SetupService;
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
      yield* Effect.forkScoped(project.open(saved));
    } else if (repo) {
      const openDetected = Effect.gen(function* () {
        const found = yield* setup.detect(repo);
        const candidate = applySuggestions(defaultSettings(repo), found);
        const validation = yield* settings.adopt(candidate);
        if (!validation.ok) {
          yield* log.log(
            "server",
            "info",
            `${repo} needs setting up: ${validation.problems.join(" ")}`
          );
          return;
        }
        const adopted = yield* settings.get;
        // Settings the user applied while the repository was read are already open.
        if (!(adopted && (yield* settings.detected))) {
          return;
        }
        yield* log.log(
          "server",
          "info",
          `opened ${repo} with detected settings; save them to keep them`
        );
        if (adopted.libraryDirs.length === 0) {
          yield* log.log(
            "server",
            "warn",
            "no components were found: Sync in the Design system panel asks where they are"
          );
        }
        yield* project.open(adopted);
      }).pipe(
        // A repository that cannot be read is left for the setup to ask about.
        Effect.catchTag("BadRequest", (error) =>
          log.log(
            "server",
            "warn",
            `could not detect ${repo}: ${error.message}`
          )
        )
      );
      yield* Effect.forkScoped(openDetected);
    }
    // The configuration file changed under us (an editor, a branch switch): follow it.
    yield* settings.changes.pipe(
      Stream.runForEach((next) => project.open(next)),
      Effect.forkScoped
    );
  })
);

const Threads = ThreadService.layer.pipe(
  Layer.provideMerge(ThreadSessions.layer),
  Layer.provideMerge(Snapshots.layer),
  Layer.provideMerge(Checkpoints.layer),
  Layer.provideMerge(AgentDiscovery.layer),
  Layer.provideMerge(AgentLauncher.layer),
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
  // The commands that expand a step's task read the setup and the sync's plan, and the
  // threads are built on them; the sync reads the setup.
  Layer.provideMerge(DesignSystemSyncService.layer),
  Layer.provideMerge(DesignSystemSetupService.layer),
  Layer.provideMerge(ProjectManager.layer),
  Layer.provideMerge(ProfileService.layer),
  Layer.provideMerge(SnapshotStore.layer),
  Layer.provideMerge(Screenshots.layer),
  Layer.provideMerge(SettingsService.layer),
  Layer.provideMerge(SetupService.layer),
  Layer.provideMerge(Storage.layer),
  Layer.provideMerge(AppLog.layer),
  Layer.provideMerge(EventBus.layer),
  Layer.provideMerge(ListenPort.layer),
  Layer.provideMerge(PreviewProxy.layer)
);

const Routes = Layer.mergeAll(
  HostGuard,
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
const Served = HttpRouter.serve(Routes, {
  disableListenLog: true,
  disableLogger: true,
}).pipe(Layer.provideMerge(Listening), Layer.provideMerge(Services));

/** And once it all answers, the run file and the ready line say so (PLAN-desktop D5). */
export const ServerLive = Announce.pipe(Layer.provide(Served));
