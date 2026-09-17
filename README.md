# ultrapaint

A local-first design tool for teams that work with coding agents. The canvas is the real
React UI, the design lives in the repository as text, and agents connect over ACP.

- Goal: [`docs/PROJECT-GOAL.md`](docs/PROJECT-GOAL.md)
- Work definition (scope, stories, spikes, milestones): [`docs/discuss/work-definition.md`](docs/discuss/work-definition.md)
- Implementation plan (investigation findings, decisions, ordered steps): [`docs/PLAN.md`](docs/PLAN.md)

## Run it

```sh
pnpm install
pnpm dev            # server + web on one origin, ports printed by the dev runner
```

Open the printed web URL, fill in the target repository in settings (there is a button that
fills the epicparty defaults), and the preview host starts inside that repository.

- `apps/web` — the editor (React, Tailwind, Base UI). No Electron imports.
- `apps/server` — local backend: settings, preview host, screens, AST edits, git, ACP threads.
- `apps/desktop` — Electron shell: runs the server and loads the web bundle, adds a folder picker.
- `packages/contracts` — Effect Schema for everything on the wire.
- `packages/host-plugin` — Vite stamping plugin and the iframe runtime.
- `packages/acp` — the only module that imports the ACP SDK; agent launch configs are data.
- `packages/client-runtime`, `packages/shared` — client connection and small utilities.

Decisions: [`docs/adr/`](docs/adr/README.md). Storage verdict: [`docs/decisions/storage-format.md`](docs/decisions/storage-format.md).
Spike results: [`docs/feature/spikes/findings.md`](docs/feature/spikes/findings.md).
