# Testing

Settings for the `up-*` skills that choose a test level. The `## Settings` section of `/up`
([`.agents/skills/up/SKILL.md`](../../.agents/skills/up/SKILL.md)) defines each one.

## Test levels

| Level | Proves | Tool | Run | Standard |
| --- | --- | --- | --- | --- |
| Unit | A pure function or a module, through its interface | Vitest; `@effect/vitest` for Effect code | `pnpm -F <package> test`; one file with `pnpm -F <package> exec vitest run <file>` | [`docs/TESTING.md`](../TESTING.md) |
| Server | The server's behaviour through its RPC and MCP tools, on a project the test builds | `@effect/vitest` with `ProjectTest`, `callTool` and the scripted agent | `pnpm -F @ultrapaint/server test` | [`docs/TESTING.md`](../TESTING.md) |
| Editor | What a person sees and does in the editor or in a frame | Vitest, happy-dom and `fakeApi` | `pnpm -F @ultrapaint/web test`, or the canvas package's own `test` | [`docs/TESTING.md`](../TESTING.md) |
| Guard | A rule the whole repository keeps, such as every agent prompt site listed (ADR 0074) | `node --test` | `pnpm test:guards` | [`docs/TESTING.md`](../TESTING.md) |
