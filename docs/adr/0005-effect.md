# ADR 0005: Effect

Status: accepted, 2026-09-17. Replaces D12's scope.

## Decision

Effect Schema (Effect 3.x stable) defines every type on the wire in `packages/contracts`:
requests, events, the preview protocol and stored files. The server decodes every inbound
payload and encodes every outbound one; the client does the same. Server services are plain
TypeScript classes. T3 Code's Effect 4 release-candidate runtime APIs were not adopted; the
value of Effect here is the shared schema, and the runtime can be introduced service by service
later without touching the contracts.
