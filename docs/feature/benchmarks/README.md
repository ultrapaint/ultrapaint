# Benchmarks: what a task costs an agent

Each directory is one comparison, run on the same tasks with the same models, and its README is
generated from its runs by `apps/server/bench/report.ts <directory>`. Runs of different
directories are never comparable: the tasks, or what they are judged by, changed between them.

| Directory | What it compares | Decided in |
|---|---|---|
| [2026-09-source-pages](2026-09-source-pages/) | No help, the project briefing, and the briefing with the editor's MCP tools, when pages were `.tsx` source | [ADR 0014](../../adr/0014-editor-mcp.md) |
| [2026-10-tool-definitions](2026-10-tool-definitions/) | The editor's MCP tools before and after their definitions were cut, on MCP 2026-07-28, with pages as design documents | [ADR 0022](../../adr/0022-mcp-2026-and-asking-the-user.md) |

The tasks of `2026-09-source-pages` asked for `.tsx` pages, which no run can produce since pages
became design documents ([ADR 0015](../../adr/0015-design-documents.md)); its numbers stand for
what they measured then and cannot be run again.

A new comparison goes in a directory of its own:

```sh
node --experimental-strip-types apps/server/bench/run.ts --arm mcp --label <name> \
  --agent claude-code --model "Opus 5" --runs 2 --out docs/feature/benchmarks/<comparison>
node --experimental-strip-types apps/server/bench/report.ts docs/feature/benchmarks/<comparison>
```
