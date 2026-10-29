# Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect apis and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.

# Effect conventions in this repository

Effect 4 is pinned through the pnpm catalog. Bump every `effect` package in the catalog together,
and never patch `effect`.

- Imports: `import { Effect, Layer, Schema } from "effect"` and named imports from the module
  paths (`effect/ai`, `effect/http`, `effect/rpc`, …; there is no `effect/unstable/*` since
  4.0.0-rc.118). No namespace imports, no `Schema as S` alias.
- One file per service, kebab-case. The file holds the `Context.Service` class with a namespaced
  tag (`"ultrapaint/server/GitService"`), `static readonly layer`, and `static readonly layerTest`
  when a fake is useful. Service shapes use property signatures
  (`get: (id: string) => Effect.Effect<...>`), not method signatures.
- Every failure is a `Schema.TaggedError`. Errors that cross the wire live in
  `packages/contracts/src/errors.ts`. No `throw` inside Effect code and no bare `catch {}`; a
  deliberate swallow is written as `Effect.ignore` or `Effect.catchTag` next to a reason.
- `Effect.fn("Service.method")` for service methods, `Effect.fnUntraced` for hot helpers.
- Configuration is resolved once in `apps/server/src/bin.ts` into `ServerConfig`. Nothing deeper
  reads `process.env` or `Config`.
- Resources are scoped: child processes, watchers, sockets and agent sessions are acquired with
  `Effect.acquireRelease` or a scoped layer. Background work uses `Effect.forkScoped`. Shutdown is
  scope closure; `NodeRuntime.runMain` owns the signals.
- Processes are stopped through the handle that spawned them, never by name or pattern.
- Pure code stays pure: a framework package (`packages/framework-react-vite`: where a
  repository's application is, and a new one written with a component for each system
  component) is synchronous and free of Effect. The server reaches it only through
  `locateFramework` (the setup's detection and scaffold) and wraps it at that boundary.
- The storage target (`managed`, `file`, `ephemeral`) is part of `ServerConfig`. Whatever touches
  the state directory asks the `Storage` service for it at the moment of use: saving an
  ephemeral session moves it while the server runs.
- Tests use `@effect/vitest`: `it.effect`, `layer(...)`, `TestClock` instead of sleeps. No
  `Effect.runPromise` inside a test body.
- `pnpm typecheck` runs the Effect language service through `@effect/tsgo` (patched in
  `prepare`), so floating effects, leaked requirements and missing service dependencies are
  compile errors.
