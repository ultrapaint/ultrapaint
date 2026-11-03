# Where things are

- `docs/development.md`: the package map and the dev commands. Read it before a change that
  crosses packages.
- `GLOSSARY.md`: the name of each concept and the module that owns it. Code, docs and commit
  messages use its names; a new concept gets its entry there.
- `docs/adr/`: the decisions, indexed in `docs/adr/README.md`. Read the ADRs behind a behaviour
  before changing it, and record a new decision as the next ADR.
- `docs/TESTING.md`: how tests are written. Read it before writing one.
- `skills/ultrapaint/`: the design skill agents are told. Its `README.md` says how it is built
  into the server.

A change is done when `pnpm typecheck`, `pnpm test` and `pnpm lint` pass (`pnpm format` fixes
what lint can). Its commit message is `type: ` and the behaviour as it now is, in one sentence,
naming the ADR it follows: `feat: the design skill has two jobs (ADR 0049): …`.

# Effect

Before writing any Effect code, read `node_modules/effect/AGENTS.md` **completely**, and follow its
links when required. For APIs it does not cover, search the source in `node_modules/effect/src`.

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
  `packages/contracts/src/errors.ts`. A deliberate swallow is written as `Effect.ignore` or
  `Effect.catchTag` next to its reason; Effect code has no `throw` and no bare `catch {}`.
- `Effect.fn("Service.method")` for service methods, `Effect.fnUntraced` for hot helpers.
- Configuration is resolved once in `apps/server/src/bin.ts` into `ServerConfig`. Nothing deeper
  reads `process.env` or `Config`.
- Resources are scoped: child processes, watchers, sockets and agent sessions are acquired with
  `Effect.acquireRelease` or a scoped layer. Background work uses `Effect.forkScoped`. Shutdown is
  scope closure; `NodeRuntime.runMain` owns the signals.
- A process is stopped through the handle that spawned it, never by name or pattern.
- Framework packages (`packages/framework-react-vite`) are pure: synchronous and free of Effect.
  The server reaches them only from the setup (`services/setup.ts`), which wraps their `detect`
  and `scaffold` in Effect.
- The storage target (`managed`, `file`, `ephemeral`) is part of `ServerConfig`. Whatever touches
  the state directory asks the `Storage` service for it at the moment of use: saving an
  ephemeral session moves it while the server runs.
- Tests use `@effect/vitest`: `it.effect`, `layer(...)`, `TestClock` for time. A test body yields
  its effects; it never calls `Effect.runPromise`.
- `pnpm test:shuffle` finds order dependence; a flaky test is fixed, never retried.
- `pnpm typecheck` runs the Effect language service through `@effect/tsgo` (patched in
  `prepare`), so floating effects, leaked requirements and missing service dependencies are
  compile errors.
