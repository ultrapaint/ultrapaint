# ADR 0009: Effect 4 runtime and RPC

Status: accepted, 2026-09-17. Supersedes ADR 0005 and D12 in `PLAN.md`.

Update, 2026-10-06: the decision stands; some details below have since changed. Effect is pinned
at `4.0.0`, its final release, and the unstable modules left `effect/unstable/*` in `rc.118`.
`packages/host-plugin` gave way to `preview-core` and `renderer-react` (ADR 0011), and the
desktop shell, preload included, was removed (ADR 0017).

## Decision

The backend runs on the Effect 4 runtime (`4.0.0-rc.115`, pinned through the pnpm catalog).
Services are `Context.Service` classes composed with `Layer`; resources are scoped; failures are
`Schema.TaggedError` values in the error channel.

The web to server API is one `RpcGroup` in `packages/contracts/src/rpc.ts`, served over a single
WebSocket route with JSON serialization. Server pushed events are streaming RPCs. The hand-rolled
frame protocol (`ipc.ts`, `router.ts`, `ws/socket.ts`) is removed. `Connection` in
`packages/client-runtime` keeps its public API on top of `RpcClient` and remains the only reconnect
owner, so `apps/web` is unchanged.

ACP stays on `@agentclientprotocol/sdk` (ADR 0004), wrapped in an `AcpAgent` service whose
interface does not expose the SDK. A native client can replace the layer later.

`packages/host-plugin`, `packages/shared`, the desktop preload and `apps/web/src` stay plain
TypeScript.

## Why now

ADR 0005 deferred the runtime because Effect 4 was early in its release candidates. T3 Code has
since run the same architecture (RpcGroup over WebSocket, streaming subscriptions, facade in
`client-runtime`) in production on `rc.112`. The server had grown to 4.5k lines of promise-based
code with five fire-and-forget sites, fifteen swallowed `catch` blocks, manual SIGTERM then SIGKILL
timers in three places and no test coverage for the stateful services. Scopes, typed errors and
layers address those directly.

## Consequences

- `effect/unstable/*` can change between release candidates. Bumps are deliberate and the RPC
  usage stays on the documented surface.
- Schema 4 treats a missing key as an error where Schema 3 accepted it for `Unknown` fields.
  Optional wire fields are declared `Schema.optional` explicitly.
- `@effect/tsgo` patches the native TypeScript compiler so the Effect language service runs in
  `pnpm typecheck`. If a TypeScript bump breaks the patch, `prepare` skips it and plain `tsc`
  still typechecks.
