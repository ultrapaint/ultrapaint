# Plan: backend rewrite on Effect 4

Status: done, 2026-09-17. Recorded in ADR 0009, which supersedes ADR 0005 and decision D12 in
`PLAN.md`. The outcome and the deviations from this plan are at the end.

## Decisions (locked with the user)

| # | Decision | Choice |
|---|----------|--------|
| E1 | Web to server transport | `effect/unstable/rpc`: one `RpcGroup` in `packages/contracts`, served over WebSocket, the 8 pushed events become streaming RPCs. `Connection` in `packages/client-runtime` keeps its public API, so `apps/web` does not change. |
| E2 | ACP | Keep `@agentclientprotocol/sdk`. Wrap it in an Effect service whose interface hides the SDK, so a native client can replace the layer later without touching the thread service. |
| E3 | Scope | `apps/server`, `packages/acp`, `packages/contracts` (Schema 3 to 4, plus the `RpcGroup`), `packages/client-runtime` internals, `apps/desktop/src/main.ts`, `scripts/dev-runner.ts`. |
| E4 | Out of scope | `apps/web/src` (only its `effect` version changes), `packages/host-plugin`, `packages/shared`, `apps/desktop/src/preload.ts`. The iframe runtime must stay dependency-free. |
| E5 | Tests | Written with each service as it is ported (`@effect/vitest`, `layerTest`), no characterization phase up front. |

Reference: T3 Code (`pingdotgg/t3code` at `dd9528a9`, Effect `4.0.0-rc.112`) uses the same transport
shape. What we deliberately do not copy: the `Services/` plus `Layers/` split, event sourcing, patching
`effect`, a native ACP client, atoms in the web app.

## Verified before planning

- `effect@4.0.0-rc.115` is installed at the root. A spike with `Context.Service`, `Layer`,
  `Schema.TaggedError`, an `RpcGroup` with dotted tags and a streaming RPC typechecks under
  TypeScript 7.0.2 with the repo's strict flags in 1.4 s.
- Ultracite flags one thing in idiomatic Effect code: service shapes must use property signatures
  (`get: (id: string) => Effect<...>`), not method signatures. Generators, classes and `static layer`
  pass.
- `@effect/vitest@4.0.0-rc.115` peers on `vitest >=5 <6`; the repo is on 5.0.1.
- Contracts use 23 distinct Schema APIs. The 3 to 4 changes are mechanical:

| Schema 3 | Schema 4 | Occurrences |
|----------|----------|------------:|
| `S.Literal("a", "b")` | `S.Literals(["a", "b"])` (single literals unchanged) | 56 to review |
| `S.Union(a, b)` | `S.Union([a, b])` | 8 |
| `S.Record({ key, value })` | `S.Record(key, value)` | 8 |
| `S.pattern(re)`, `S.positive()`, `S.nonNegative()`, `S.minLength(n)` | `S.check(S.isPattern(re))`, `isGreaterThan(0)`, `isGreaterThanOrEqualTo(0)`, `isMinLength(n)` | 4 |
| `S.decodeUnknownEither` | `S.decodeUnknownResult` or `decodeUnknownEffect` | 6 |
| `S.Array`, `S.Struct`, `S.optional`, `S.NullOr`, `S.suspend`, `S.Int`, `S.Unknown`, `S.Void` | unchanged (all verified present in rc.115) | 250+ |

## Conventions

Written into `AGENTS.md` in phase 0 so every later session follows them.

- Imports: `import { Effect, Layer, Schema } from "effect"` and named imports from
  `effect/unstable/*`. This matches Effect's own guide and ultracite's `noNamespaceImport`. `Schema` is
  no longer aliased to `S`.
- One file per service, kebab-case filename: the `Context.Service` class with a namespaced tag
  (`"ultrapaint/server/GitService"`), `static readonly layer`, and `static readonly layerTest` where a
  fake is useful. Service shapes use property signatures.
- Every failure is a `Schema.TaggedError`, unioned per module. No `throw`, no bare `catch {}`. The
  existing swallow sites become explicit `Effect.catchTag` or `Effect.ignore({ log: true })`.
- `Effect.fn("Service.method")` for every service method; `Effect.fnUntraced` for hot helpers in
  `source.ts`.
- Config is resolved once at the CLI boundary into a plain `ServerConfig` record and provided with
  `Layer.succeed`. Nothing deeper reads `Config` or `process.env`.
- Shutdown runs through scopes and finalizers. `NodeRuntime.runMain` owns the signals.
- Time, randomness and ids go through `Clock`, `DateTime`, `Random`. `newId` in `packages/shared`
  stays for the web app; the server gets an `Ids` helper built on `Random`.
- Tests: `it.effect` and `layer(...)` from `@effect/vitest`, `TestClock` instead of sleeps,
  `Layer.mock` for ad hoc fakes. No `Effect.runPromise` in test bodies.

## Target architecture

```
packages/contracts
  base, settings, project, screens, edit, catalogue, git, threads, preview   Schema 4
  errors.ts      tagged errors shared on the wire
  rpc.ts         UltrapaintRpcs = RpcGroup.make(38 request RPCs + 8 streaming RPCs)
  ipc.ts         deleted once the old frames are gone

packages/acp
  acp-agent.ts        AcpAgent service: scoped process, updates as a Stream, typed calls
  terminal-manager.ts scoped service, one fiber per terminal, bounded output buffer
  configs.ts          unchanged (data)
  errors.ts           AcpSpawnError | AcpProcessExitedError | AcpRequestError | AcpTransportError

apps/server/src
  bin.ts              unstable/cli command, flags with env fallback, NodeRuntime.runMain
  config.ts           ServerConfig
  server.ts           HttpRouter: /api/health, /ws, static files; Layer.launch
  rpc-handlers.ts     UltrapaintRpcs.toLayer(...)
  events.ts           EventBus: one PubSub per event, exposed as Streams
  logs.ts             LogBuffer: ring buffer plus a Logger that feeds the `log` stream
  project.ts          ProjectMap (LayerMap keyed by a settings hash) and CurrentProject
  keyed-lock.ts       SynchronizedRef<Map<string, Semaphore>>
  atomic-write.ts     temp sibling plus rename over FileSystem
  services/           repo-paths, settings, git, host, screens, edit, catalogue, threads
  services/source.ts  stays pure and synchronous; only its errors become tagged

packages/client-runtime
  connection.ts       same public API; internals are RpcClient over Socket.layerWebSocket
```

Mapping from today's code:

| Today | Becomes |
|-------|---------|
| `AppContext` object, `createContext` | The application `Layer` graph |
| `ProjectRuntime.open()` tearing down and rebuilding services | `LayerMap.Service`; `settings.set` invalidates the key, the next call rebuilds. Host, watcher and threads are released by their scopes. |
| `Router` plus `AppError` plus the single try/catch | `RpcServer`; each RPC declares its own error union |
| `EventBus` `Set<Subscriber>` and `ws/socket.ts` broadcast | `PubSub` per event, each streaming RPC is `Stream.fromPubSub` |
| `KeyedQueue` promise chains | per-key `Semaphore` |
| `spawn` plus manual SIGTERM then SIGKILL timers | `ChildProcessSpawner` inside a scope, `kill({ forceKillAfter })` in the finalizer |
| `waitForPort` 150 ms loop | `Effect.retry` with `Schedule.spaced("150 millis")` and a 30 s timeout |
| chokidar plus an 80 ms `setTimeout` | `FileSystem.watch(dir, { recursive: true })`, filter, `Stream.debounce` (see risk R3) |
| `pendingPermissions: Map<string, resolve>` | `Deferred` per request, completed as cancelled by the session finalizer |
| Fire and forget promises (5 sites) | `Effect.forkScoped` in the owning scope, failures logged |
| `console.*` plus the ring buffer | `Logger.layer([consolePretty, logBufferLogger])` |

## Phases

Each phase ends with `pnpm typecheck`, `pnpm lint`, `pnpm test` green and the app working through
`pnpm dev`. One commit or small series per phase on a `effect-v4` branch.

### Phase 0: foundations

1. Branch from a clean tree. The 19 modified files under `apps/web` are unrelated and should be
   committed or stashed first.
2. `pnpm-workspace.yaml` catalog pinning `effect`, `@effect/platform-node`, `@effect/vitest` to
   `4.0.0-rc.115`, with `overrides: { effect: "catalog:" }` and the RC line added to
   `minimumReleaseAgeExclude`. Replace `effect ^3.22.2` in `server`, `web`, `contracts`,
   `client-runtime` with `catalog:`; add it to `acp` and `desktop`.
3. Add `@effect/tsgo`, `"prepare": "effect-tsgo patch"`, and the `@effect/language-service` plugin block
   in `tsconfig.base.json` with `missingEffectServiceDependency`, `leakingRequirements`,
   `anyUnknownInErrorContext`, `globalErrorInEffectCatch` as errors. `importFromBarrel` stays off (we
   use the barrel on purpose). Browser overrides in `apps/web/tsconfig.json`.
4. Extend `AGENTS.md` with the conventions above. Write ADR 0009 (Effect 4 runtime and RPC), mark 0005
   superseded, note the change against D12.
5. Exit: the unchanged app still builds and runs with both the old code and the new dependencies.

### Phase 1: contracts to Schema 4

1. Port the nine schema files using the table above. `ipc.ts` keeps working for now, ported as is.
2. Add `errors.ts`: `BadRequest`, `NotFound`, `NotConfigured`, `ForbiddenPath`, `Stale`, `Conflict`,
   `HostError`, `AgentError`, mirroring today's `ErrorCode` union, each carrying `message`.
3. Add `rpc.ts`: the 38 request RPCs with the current method names as tags, payload and success
   schemas lifted from `ipc.ts`, plus a per-method error union. 8 streaming RPCs:
   `events.agent`, `events.canvas`, `events.editState`, `events.fileChanged`, `events.git`,
   `events.log`, `events.project`, `events.screens`.
4. Update decode and encode call sites in `router.ts`, `socket.ts`, `connection.ts`, `settings.ts`.
5. Tests: port `ipc.test.ts`; add round-trip tests for `EditOp`, `ThreadItem`, `HostMessage`,
   `TreeNode` (the recursive and union-heavy schemas).
6. Exit: app runs end to end on Schema 4 over the old transport. The web app needs no source changes
   beyond the version.

### Phase 2: server core and leaf services

1. `ServerConfig`, `bin.ts` on `unstable/cli` (`--home`, `--port`, `--web-dist`, each with
   `Flag.withFallbackConfig` for the existing `ULTRAPAINT_*` variables), `LogBuffer`, `EventBus`,
   `keyed-lock.ts`, `atomic-write.ts`.
2. Port `RepoPaths`, `SettingsService`, `GitService` (one `runGit` over `ChildProcessSpawner`, a
   semaphore capping concurrent git processes, `snapshot` with bounded concurrency instead of the
   sequential reduce).
3. Bridge: the old `Router` runs the new services through one `ManagedRuntime`, so the app keeps
   working while the remaining services are ported.
4. Tests: `RepoPaths` containment including symlinks; settings load, validate, persist against a temp
   home; git against a temp repository with pinned `GIT_CONFIG_*`.

### Phase 3: project services

1. `ProjectMap` and `CurrentProject`.
2. `HostManager`: scoped Vite child, stdout and stderr streamed into the log, readiness by retry
   schedule, status in a `SubscriptionRef` that feeds `events.project`.
3. `ScreensService`: watcher stream, debounced list, `canvas.json`, CRUD.
4. `EditService`: per-file lock, formatter through the spawner with a 15 s timeout, journal in a
   `Ref`. `source.ts` keeps its 11 tests and gains tagged errors.
5. `CatalogueService`: the TypeScript 5 compiler work stays synchronous inside `Effect.sync`, run
   off the main fiber; the disk cache moves to `atomic-write`.
6. Tests: edit, undo, redo and stale hash on a temp repo with a fake formatter; screens CRUD and
   watcher events; host lifecycle against a `Layer.mock` spawner; catalogue cache hit and miss.

### Phase 4: ACP and threads

1. `packages/acp`: `AcpAgent.layer(config, cwd)` acquires the process and the SDK connection and
   releases both. Surface: `initialize`, `authenticate`, `newSession`, `loadSession`, `prompt`,
   `cancel`, `setMode`, `setConfigOption`, `updates: Stream<SessionUpdate>`, and a handler record for
   permission, `fs/*` and `terminal/*` that returns Effects. `TerminalManager` as a scoped service.
2. `ThreadService` (1,076 lines today) splits into: thread store (JSON persistence), transcript
   projection (pure, from `session/update` to `ThreadItem`), live session (one scope per thread:
   agent, terminals, pending permissions, remembered decisions), checkpoints, and the LCS diff helper.
   A prompt turn is a fiber in the session scope; `threads.cancel` sends `session/cancel` and
   interrupts it.
3. Tests: a fake ACP agent script built on the SDK's agent side, driven by environment flags: plain
   reply, tool call, permission round trip, exit mid turn, malformed output. Transcript projection is
   table-tested as a pure function.
4. Manual check against real Claude Code and Codex, repeating the list in ADR 0004.

### Phase 5: transport swap

1. Server: `rpc-handlers.ts`; `server.ts` with `HttpRouter`, `RpcServer` over WebSocket with JSON
   serialization, the origin allowlist from `socket.ts` applied at upgrade, static files through
   `HttpStaticServer`, bound to `127.0.0.1`.
2. Client: `Connection` keeps `request`, `on`, state and `RequestError`. Internally it holds a
   `ManagedRuntime` with `RpcClient` over `Socket.layerWebSocket`, RPC retry disabled, and the existing
   250 ms to 5 s backoff as the only reconnect owner. `on(event)` runs the matching streaming RPC and
   re-subscribes on each new session. In-flight requests fail on disconnect as they do today. Tagged
   errors map to the existing `RequestError.code` values.
3. Delete `router.ts`, `handlers.ts`, `ws/socket.ts`, `util.ts`, `context.ts`, the `ManagedRuntime`
   bridge, `ipc.ts`, and the `ws`, `@types/ws` and `chokidar` dependencies.
4. Tests: a real server on an ephemeral port with a real `RpcClient`; request, typed error, stream
   delivery, re-subscribe after reconnect, origin rejection. `Connection` tested against a fake
   `WebSocketConstructor` with `TestClock` for the backoff.

### Phase 6: desktop and dev runner

1. `apps/desktop/src/main.ts`: free port, spawn the server through `ChildProcessSpawner` in the app
   scope, health check by retry schedule, kill on scope close. Electron calls stay direct; no wrapper
   services for 89 lines. `preload.ts` unchanged.
2. `scripts/dev-runner.ts`: `unstable/cli` plus `unstable/process`, prefixed output, both children tied
   to one scope.
3. esbuild: decide per bundle whether `effect` and `@effect/platform-node` are bundled or external, then
   smoke-test the packaged desktop app.

### Phase 7: cleanup

`knip`-style sweep for dead exports, README and `docs/PLAN.md` references, remove the `typescript`
runtime dependency of the server if nothing else needs it, final full manual pass.

## Risks

| # | Risk | Mitigation |
|---|------|------------|
| R1 | Effect 4 is a release candidate and `unstable/*` can change between RCs. | Exact pin through the catalog, bump deliberately one RC at a time, never patch `effect`. RPC usage stays on the documented surface (`RpcGroup`, `RpcServer`, `RpcClient`, `RpcSerialization.layerJson`). |
| R2 | No tests exist for the stateful services, and E5 means none are added first. | Port one service at a time behind the bridge so regressions are attributable; write tests in the same change; manual checklist per phase. `threads.ts` is the highest risk and goes last before the transport. |
| R3 | `FileSystem.watch` wraps `fs.watch`: no `awaitWriteFinish`, and recursive watching has platform caveats. | Debounce plus re-hash on read covers partial writes. If a gap shows up, keep chokidar behind the same `Stream` interface; the service contract does not change. Decide in phase 3 with a focused test. |
| R4 | `@effect/tsgo` patches the native compiler. | If `effect-tsgo patch` misbehaves on TS 7.0.2, drop it; plain `tsc` already typechecks Effect 4. It is a lint aid, not a dependency. |
| R5 | Bundle size in `apps/web` from `RpcClient` and `Socket`. | Measure in phase 5; `effect` is `sideEffects: []`. Schema is already in the bundle today. |
| R6 | Behaviour drift in the SDK wrapper (permission ordering, cancel semantics). | Interface first (E2), fake agent tests, then the ADR 0004 manual list against both real agents. |

## Size

About 5,000 lines rewritten: server 4,526, acp 339, client-runtime 190, desktop 89, dev runner 52, plus
918 lines of contracts ported mechanically. `source.ts` (794) and the compiler-API half of
`catalogue.ts` stay largely as they are. Phases 3 and 4 are roughly half the work.

## Outcome

All phases are done on the `effect-v4` branch. Tests went from 19 to 65; `apps/web/src` is
unchanged and its bundle shrank from 995 kB to 856 kB (313 to 275 kB gzip), because Effect 4
tree-shakes better than 3 even with the RPC client added.

Verified by running it: the server over a real WebSocket (17 tests), agent threads against a
scripted ACP agent (16), the `Connection` facade across a server restart (2), the ACP wrapper and
terminals against real processes (10), the editor in a browser through Vite's `/ws` proxy
(settings, screens, pushed events, reconnect after a `tsx watch` restart), the esbuild server bundle
with static files, `pnpm dev` and its Ctrl-C cleanup, and the Electron shell starting the server and
taking it down on SIGTERM. Not run: quitting Electron from its menu (same scope close, reached
through `before-quit`), and the real Claude Code and Codex agents (the ADR 0004 checklist).

### Deviations

- **No `ManagedRuntime` bridge.** The old server moved to `src-legacy` and kept running while the
  new one was built beside it, then was deleted at the swap. Same guarantee, no throwaway glue.
- **`Scope` plus `Layer.buildWithScope` instead of `LayerMap`** for the open project. `LayerMap` is a
  keyed cache with idle eviction; the project is a singleton that must stay alive with no request
  in flight. Agent sessions are scopes forked from the project scope.
- **The ACP agent process is spawned with `node:child_process`,** not `ChildProcessSpawner`: the SDK
  wants web streams over stdio and that wiring was already verified against real agents. It runs
  in its own process group inside `acquireRelease`. Terminals and everything else use the spawner.
- **`threads.cancel` does not interrupt the turn fiber.** It sends `session/cancel` and lets the agent
  answer the prompt with `cancelled`, so the transcript records how the turn really ended.
- **The catalogue build still blocks the event loop** for its few seconds, as before. It is
  serialised so two requests cannot build twice; moving it to a worker is a separate change.

### Found on the way

- Schema 4 rejects a missing key where Schema 3 accepted it for `Unknown` fields. The old frame
  schema broke on every request without input until its fields were made explicitly optional.
- The ACP SDK answers a request synchronously but dispatches notifications through an async chain,
  so a prompt's response can overtake its last updates. The old server had the same race, hidden by
  a slow `git` call. `AcpAgent.drained` waits one macrotask and then for the update queue.
- When the agent dies, the SDK rejects the call in flight slightly before Node reports the exit.
  A failed call now checks for the exit first, so the editor sees "agent exited".
- `RpcClient`'s own retry keeps its backoff after a successful reconnect. `Connection` disables it
  and owns reconnection, with a backoff that resets once a socket opens.
- `Effect.provide(layer)` closes the layer when that effect ends. The client's socket protocol has
  to be built into the session scope with `Layer.build`.
- `NodeHttpServer` waits 20 s for connections to drain before closing request scopes, and the
  editor's WebSocket never drains. `disablePreemptiveShutdown` brings shutdown to about 60 ms.
- "Remember this choice" stored a permission under the tool title and looked it up under the tool
  kind, so it never matched when the agent sent a kind. Both now use the same key.
