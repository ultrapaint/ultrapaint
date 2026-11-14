# Naming

Settings for the `up-*` skills that name a piece of work. The `## Settings` section of `/up`
([`.agents/skills/up/SKILL.md`](../../.agents/skills/up/SKILL.md)) defines each one.

## Scopes

One scope names a piece of work on its issue title (`editor: snap a frame to the grid`), its
branch (`feat/editor-grid-snap`) and its `area:*` label. **Commit subjects take no scope**: they
keep the root `AGENTS.md` form, `type: ` and the behaviour as it now is, naming the ADR it follows.

| Scope | Covers |
| --- | --- |
| `editor` | `apps/web`, `packages/preview-core`, `packages/renderer-react`, `packages/system-components`, `packages/client-runtime` |
| `server` | `apps/server`, `packages/contracts`, `packages/acp` |
| `document` | `packages/design-document`, `packages/design-md`, `packages/figma-import`, `packages/style-tailwind-v4`, `packages/framework-*`, `packages/design-checks` |
| `desktop` | `apps/desktop` |
| `cli` | The `ultrapaint` command (`scripts/command.ts`, `scripts/cli.ts`), the package (`scripts/pack.ts`) and the release |
| `skill` | `skills/ultrapaint/` |
| `evals` | `evals/`, `evals/gaps/` |
| `repo` | CI, root tooling, `docs/` outside a single area, the agent setup |

`packages/shared` takes the scope of the area the change is for. A change across several areas
takes the one its goal belongs to.
