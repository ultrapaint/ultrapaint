# Implementation plan: ultrapaint v1

Status: executed, 2026-09-17. See section 6 for what was built and what remains. Inputs: [`PROJECT-GOAL.md`](PROJECT-GOAL.md),
[`discuss/work-definition.md`](discuss/work-definition.md), and the investigation in section 1.
This plan turns the milestones of the work definition into ordered, checkable steps.

Changed since: step 2.3 (settings under one tool home) is replaced by the storage modes of
[ADR 0010](adr/0010-storage-modes.md). D13, D14 and `packages/host-plugin` (D20, steps 3.x) are
replaced by the editor / preview core / renderer / framework split of
[ADR 0011](adr/0011-preview-split.md): the designs directory no longer has to be a package.

---

## 1. Investigation findings (what changes the plan)

Verified on this machine on 2026-09-17.

### 1.1 This repository

- `ultrapaint` contains three markdown files and no code. It is **not yet a git repository**.

### 1.2 Toolchain present

| Tool | Version | Note |
|------|---------|------|
| node | 24.14.0 | installed by vite-plus |
| pnpm | 11.7.0 | epicparty pins `pnpm@11.11.0`; T3 Code pins `11.10.0` |
| vp (vite-plus) | present | npm latest 0.3.2, epicparty uses 0.2.9 |
| bun | 1.3.14 | epicparty uses bun for tooling scripts |
| claude (Claude Code) | 2.1.272 | agent binary for the Claude ACP adapter |
| codex | 0.154.0 | agent binary for the Codex ACP adapter |
| gh | authenticated | used to read T3 Code without cloning |
| ACP adapters | **missing** | see 1.5 |

### 1.3 Target repository: epicparty (`~/Code/epicparty/epicparty-1`, branch `main`)

- Workspace globs: `products/*`, `products/{identity,pro,tools,prime,hq}/*`, `products/{...}/*/*`,
  `shared/*`, `tooling/*`, `ui/*`. A `products/prime/designs/package.json` would be picked up as a
  workspace package automatically.
- Versions from the pnpm catalog: React 19.2.7, Tailwind 4.3.2, `@base-ui/react` 1.7.0,
  `class-variance-authority` 0.7.1, `vite` 8.2.2 (**overridden to `@voidzero-dev/vite-plus-core`**),
  `@vitejs/plugin-react` 6.0.3 with `@rolldown/plugin-babel` and `babel-plugin-react-compiler`
  (React Compiler is on; Biome enforces `useReactCompiler`), Storybook 10.5 on
  `@storybook/tanstack-react`, Lingui 6.5, TypeScript 7.0.2, ultracite 7.10.6 / Biome 2.5.10.
- **Vite 8 is rolldown-based.** A JSX source-stamping transform must run either as a Babel plugin
  through `@rolldown/plugin-babel` (the path the repo already uses for React Compiler) or as a
  plain Vite `transform` hook using oxc/Babel parsing. This constrains spike S2.
- Styling entry: `@epicparty/ui-components/styles/tailwind.css` imports the design-system Tailwind,
  `tw-animate-css`, `shadcn/tailwind.css`, and declares `@source` globs. Any design host must add
  an `@source` for the designs directory or utilities used only in screens will generate no CSS.
- Theme: `data-theme="light|dark"` attribute on the root, no `.dark` class. Brand colours per
  product in `products/<product>/ui/theme/src/colors.css`. Fonts from `@fontsource-variable/*`.
- `cn()` is `twMerge(clsx(...))` in `ui/components/src/components/utils.ts`. Class order rules
  (base, motion, states, context) are in `ui/components/AGENTS.md`; token rules in
  `docs/standards/STYLES.md`.
- Components: 105 files in `ui/components/src/components`, `cva` variants with
  `VariantProps`, Base UI primitives. Stories use `render()` functions with the title convention
  `"Components · Name"`, **not** CSF args. Prop metadata therefore has to come from TypeScript
  types and the `cva` config, not from stories. Stories are still usable as rendered previews.
- Product apps need Convex, SST and `.env` (confirmed in `products/prime/apps/web-app`). The
  dedicated design host (D3) is the right call.

### 1.4 Structural reference: T3 Code (`pingdotgg/t3code`, read via GitHub API, not cloned)

- Workspace: `apps/{web,server,desktop,mobile,marketing}`, `packages/{contracts,shared,client-runtime,effect-acp,effect-codex-app-server,ssh,tailscale}`, `infra/*`, `scripts`.
- Root scripts drive everything through `vp` and a `scripts/dev-runner.ts`; dev is single origin,
  the web dev server proxies `/api` and `/ws`. `packages/contracts` is Effect Schema; `ipc.ts`
  is the single request/event surface.
- `packages/effect-acp` **generates** its ACP schema from the protocol's published schema
  (`_generated/schema.gen.ts`, `@effect/openapi-generator`) and exposes `client`, `agent`,
  `schema`, `protocol`, `errors`. It uses Effect **4.0.0-rc** (`effect/unstable/rpc`,
  `effect/unstable/process`). npm stable Effect is 3.22.2. This is a version decision for us.
- T3 Code's `AGENTS.md` rules worth adopting: never kill by pattern, never bake origins into
  the bundle, typed receipts instead of sleeps in tests, everything on the wire in contracts.

### 1.5 ACP ecosystem

| Package | Version | Use |
|---------|---------|-----|
| `@agentclientprotocol/sdk` | 1.4.0 | protocol SDK (D9) |
| `@zed-industries/claude-agent-acp` | 0.23.1 | Claude Code adapter (the work definition's `claude-agent-acp`) |
| `@zed-industries/codex-acp` | 0.16.0 | Codex adapter (the work definition's `codex-acp`) |

Neither adapter is installed. The launch configurations must reference these package names.

### 1.6 Previous attempt (`epicparty-design`, OpenPencil fork)

Confirms the pain points in the work definition. Reusable ideas: loopback-only server, bearer
token plus origin check on the local API, symlink-safe path guard, atomic writes, one undo entry
per mutating call.

---

## 2. Decisions to lock before step 1

The work definition's D1 to D11 stand. The investigation adds these. Each has a recommendation;
changing one changes the plan, not the scope.

| # | Decision | Recommendation |
|---|----------|----------------|
| D12 | Effect version | **Effect 3.x stable** for server and contracts. T3 Code's Effect 4 rc APIs (`unstable/rpc`, `unstable/process`) are not stable and would force us to track T3 Code's patches. Use `@effect/platform` and `@effect/platform-node` 3.x. Re-evaluate when Effect 4 ships. |
| D13 | Where the design host config lives | The backend **spawns the target repo's own `vite` binary** (`<repo>/node_modules/.bin/vite`) with a config file the backend generates into `<repo>/.ultrapaint/host/` (gitignored). The generated config imports the target's Tailwind entry, brand theme, fonts and providers as declared in settings. No package needs to be installed in the target repo. |
| D14 | Screens location in epicparty | `products/prime/designs/` as a workspace package `@epicparty-prime/designs` with `@epicparty/ui-components` and `@epicparty-prime/ui-theme` as dependencies. This makes module resolution and the pnpm catalog work without special casing. Answers Q2. |
| D15 | Editor UI kit | Own minimal set in `apps/web` (Tailwind 4, Base UI). Answers Q1 with D7. |
| D16 | Localisation in screens | Plain strings in v1. Lingui macros are a Babel transform and would complicate the stamping and the text edit path. Answers Q4; E4.4 becomes "JSX text and string literals only". |
| D17 | Source stamping mechanism | Babel plugin executed through the target's existing `@rolldown/plugin-babel` chain, restricted to the designs directory and design-system paths. Attribute: `data-ed="<fileId>:<line>:<col>"` with a file table per screen to keep DOM attributes short. Confirmed or replaced by spike S2. |
| D18 | Reference machine | This Mac (Darwin 25.6.0, Apple Silicon). Answers Q7. |
| D19 | Repository visibility | Private for v1. Answers Q6. |
| D20 | Package names | `@ultrapaint/web`, `@ultrapaint/server`, `@ultrapaint/contracts`, `@ultrapaint/shared`, `@ultrapaint/client-runtime`, `@ultrapaint/acp`, `@ultrapaint/host-plugin` (the Vite plugin injected into the design host). |

---

## 3. Steps

Each step lists its deliverable, the files or packages it touches, and how to check it. Steps
inside a phase are ordered by dependency. Sizes follow the work definition (S, M, L).

### Phase 0: Bootstrap (before any spike)

**Step 0.1 Initialise the repository** (S)
`git init`, `.gitignore` (node_modules, `.vite-plus`, `.ultrapaint`, `.env`), `pnpm-workspace.yaml`
with `apps/*`, `packages/*`, `spikes/*`; root `package.json` with `packageManager: pnpm@11.11.0`
(match epicparty), `vp` as the runner, Biome via ultracite with the same base rules as epicparty
minus the Convex overrides. `tsconfig.base.json` copied from epicparty's `tooling/typescript-config/base.json`.
Check: `pnpm install` and `vp lint` run on an empty workspace.

**Step 0.2 Create the screens package in epicparty** (S)
On a branch in `epicparty-1`: `products/prime/designs/package.json` (`@epicparty-prime/designs`,
deps on `@epicparty/ui-components`, `@epicparty-prime/ui-theme`, react), a `tsconfig.json`, and
one hand-written screen `onboarding/welcome.tsx` using `Button` and `Card`. Verify `pnpm install`
picks it up and `ultracite check` passes on the file. This is the fixture for every spike and
milestone.
Check: `pnpm -F @epicparty-prime/designs tsc` passes.

### Phase 1: Spikes (timeboxed, throwaway, in `spikes/`)

All findings go to `docs/feature/<spike>/findings.md`. Steps 1.1 and 1.2 gate M1 and M2, step 1.3
gates M5, step 1.4 gates M4. They are independent and can run in parallel.

**Step 1.1 Spike S1: canvas embedding** (2 days)
A single Vite app in `spikes/canvas` with a CSS-transformed surface holding 8 iframes pointing at
a trivial page. Implement pan (space-drag, wheel), zoom around the cursor (ctrl-wheel, pinch), and
pointer forwarding through a transparent overlay that maps the cursor to the frame under it.
Measure frame time with `PerformanceObserver` during a scripted pan. Compare:
(a) one iframe per screen, (b) one iframe with all screens, (c) `transform: scale` vs
`zoom` on the iframe container for text crispness.
Pass: 60 fps pan with 8 frames on the reference machine; text crisp at 50 % and 200 %;
clicks reach the frame under the cursor; a decision between (a) and (b) with numbers.

**Step 1.2 Spike S2: source stamping and edit round trip** (3 days)
Inside `epicparty-1` on the branch from 0.2: a temporary `vite.config.ts` in
`products/prime/designs/` that mounts one screen, with a Babel plugin (through
`@rolldown/plugin-babel`) that stamps `data-ed` on JSX elements in the designs directory and in
`ui/components/src`. Then a Node script that takes `file:line:col` and a new Tailwind class,
performs the AST edit, formats with `ultracite fix`, and writes atomically. Compare `oxc`
(via `oxc-parser` + magic-string), Babel, and `ts-morph` for the edit on speed and diff
stability. Measure time from write to HMR-applied DOM change.
Pass: click resolves to the exact JSX element; round trip under 300 ms; `ultracite check` passes;
`git diff` shows one attribute changed; React Compiler still compiles the stamped file.

**Step 1.3 Spike S3: ACP round trip** (2 days)
`spikes/acp`: a Node host on `@agentclientprotocol/sdk` 1.4.0 that spawns
`@zed-industries/claude-agent-acp` and `@zed-industries/codex-acp` with `cwd` set to
`epicparty-1`, runs `initialize`, `session/new`, `session/prompt` asking to change a class in
the fixture screen, logs every `session/update`, answers `session/request_permission`, and sends
`session/cancel` on a second prompt. Record each adapter's authentication needs, environment
variables, and how models and modes are advertised.
Pass: both agents edit the fixture file; a permission round trip works; cancel stops the turn;
a draft of both launch configurations exists as JSON.

**Step 1.4 Spike S4: component catalogue** (2 days)
`spikes/catalogue`: a script that walks `ui/components/src/components/*.tsx`, uses the
TypeScript compiler API to extract exported components, prop names, types, enum members,
required flags and defaults, and parses `cva()` calls for variant names and members. Try
`react-docgen-typescript` first; fall back to a direct `ts.TypeChecker` walk if Base UI's
generic `Props` types defeat it. Test whether Storybook's `iframe.html?id=` for a story can be
embedded as a preview.
Pass: 90 % of the 105 components yield usable metadata; a `Button` with its `variant` enum
inserts into the fixture screen from extracted data and renders.

**Step 1.5 Spike review and ADRs** (1 day)
Write `docs/adr/` entries for D3, D4/D17, D5, D9, D12, D13 using the findings. Update the work
definition's decisions table. Delete or archive spike code.

### Phase 2: M0 Foundations

**Step 2.1 Workspace scaffold** (E0.1, M)
Create `apps/web` (Vite, React 19, Tailwind 4, TanStack Router), `apps/server` (Node 24, Effect
3, `ws`), `packages/contracts`, `packages/shared`, `packages/client-runtime`, `packages/acp`
(empty until M5), `packages/host-plugin`. Add `scripts/dev-runner.ts` in T3 Code's shape: starts
server on a port derived from the checkout path, starts web with a proxy for `/api` and `/ws`,
prints both. Root scripts: `dev`, `build`, `typecheck`, `lint`, `test`.
Check: `pnpm dev` opens the web app on one origin; a `/api/health` request returns JSON.

**Step 2.2 Wire contract** (E0.2, M)
In `packages/contracts`: `baseSchemas.ts` (ids, paths, timestamps), `ipc.ts` with a
request/response map and a server event union, both Effect Schema. In `packages/client-runtime`:
a WebSocket client with typed `request(name, input)` and `subscribe(channel)` and reconnect. In
`apps/server`: a WebSocket router that decodes every message with the schema and answers with a
typed error on failure.
Check: a decoding test in `contracts`, a round-trip test in `server`, and one bad payload
producing a typed error on the client.

**Step 2.3 Settings and tool home** (E0.3, M)
Server: `~/.ultrapaint/settings.json` with `repoPath`, `designsDir`, `designSystemPackages`,
`hostEntry` (Tailwind entry, theme attribute, font imports, provider module). Validate the repo
path (git repository, `package.json`, `node_modules/.bin/vite` present). A `RepoPath` service
that resolves every later path with `realpath` and refuses anything outside the repo. Web:
settings screen with those fields and validation messages.
Check: unit tests for the path guard including symlink escape; settings persist across restarts.

**Step 2.4 Project open and health** (E0.4, S)
Server: `project.open` returning repo name, branch, designs directory, and host status. Web: app
shell with toolbar, left panel, right panel, canvas placeholder, and a header showing the project
info. A global error surface for backend failures.
Check: M0 demo from the work definition.

### Phase 3: M1 Walking skeleton

**Step 3.1 Host plugin package** (E1.1 part 1, M)
`packages/host-plugin`: the Babel stamping plugin from spike S2 as a proper package with an
include list, plus a small runtime module injected into every screen page that: reports the
element tree, computed styles and bounding boxes to the parent over `postMessage`, receives
hover and selection commands, and reports HMR events.
Check: unit tests for the stamping on fixtures; a contract for the `postMessage` protocol in
`packages/contracts/preview.ts`.

**Step 3.2 Design host process** (E1.1 part 2, L)
Server: `HostManager` service that generates `<repo>/.ultrapaint/host/{vite.config.ts,index.html,main.tsx}`
from settings, spawns the target's `vite` binary as a child process with a free port, tracks the
PID, streams its stdout to the tool log, and kills by PID on shutdown. Routes: one URL per screen
(`/screen/<relative path>`), served by the generated entry that lazy-imports the screen and wraps
it with the configured providers and theme attribute.
Check: with epicparty configured, the host starts in under 10 s and serves the fixture screen;
stopping the tool leaves no `vite` process behind.

**Step 3.3 Screen discovery** (E1.2, S)
Server: `chokidar` watcher over the designs directory producing `screen.list` and
`screen.changed` events. Web: a screens list grouped by subdirectory.
Check: add, rename and delete a file and see the list update within one second.

**Step 3.4 One screen on the canvas** (E1.3, E1.5, M)
Web: a `Frame` component with an iframe at a viewport preset, using the embedding approach chosen
in S1. Compile and runtime errors are rendered by the host runtime inside the frame with file and
line.
Check: the fixture screen renders and is clickable; a deliberate syntax error shows in the frame.

**Step 3.5 Hot update path** (E1.4, M)
Host runtime reports `hmr:applied`; the web app re-requests the tree and re-resolves the current
selection by source location, falling back to DOM path.
Check: editing the fixture in an external editor updates the frame within 500 ms and keeps the
selection.

**Step 3.6 Layers panel** (E2.1, E2.3, M)
Web: a virtualised tree fed by the host runtime's element tree. Nodes: component instances by
name (from the stamp), host elements by tag plus summary, text summarised. Expanded state kept
by source location.
Check: the tree matches the DOM of the fixture and updates on interaction without resetting scroll.

**Step 3.7 Two-way selection and keyboard navigation** (E2.2, E2.4, M)
Overlay on the canvas drawing hover and selection outlines with size labels, computed from the
bounding boxes the host reports and the current canvas transform. Selection is a
`{ source, domPath }` pair. Arrow keys, Escape, and modifier-click behave as specified.
Check: clicking in the frame or in the tree selects the same element in both.

**Step 3.8 Inspector, read side** (E3.1, E3.2, L)
Host runtime reports computed style and the matched class list for the selected element. Server:
a `StyleResolver` that maps each computed value to its origin: a Tailwind utility from the
element's `className`, a `cva` variant class, a `--ds-*` token, inherited, or default. Web:
Layout, Size, Spacing, Typography, Colour, Border, Effects groups with provenance badges;
unattributable values read-only with the reason.
Check: M1 demo: padding, font and colour of the fixture button show with the class that produced each.

### Phase 4: M2 Edit loop

**Step 4.1 Code edit service** (E4.1 core, L)
Server: `CodeEditService` with three operations on a `{ file, line, col }` target:
`setClassName`, `setAttribute`, `setText`. Implementation per spike S2 winner. Tailwind edits
replace the conflicting utility using `tailwind-merge` semantics, then reorder per the target's
category rules. Every write: read, edit, format with the target's formatter, write atomically,
return the new content hash.
Check: fixture-based tests asserting the diff is one attribute and `ultracite check` passes.

**Step 4.2 Inspector write side** (E4.1 UI, E4.3, M)
Controls commit through `edit.apply`. Token-first pickers for colour, spacing, radius and
typography, reading the design-system `@theme` and `--ds-*` tokens from the host; arbitrary
values written as `[value]`; recently used pinned.
Check: M2 demo.

**Step 4.3 Prop edits** (E4.2, M)
`setAttribute` with literal kinds; the inspector's Component section becomes editable once E6.1
lands, but string and boolean props work here from the stamp's component name alone.

**Step 4.4 Inline text edit** (E4.4 under D16, M)
Double-click on a text element opens a contenteditable overlay; commit calls `setText`.

**Step 4.5 Undo and redo** (E4.5, M)
Server-side edit journal per file with before and after hashes; undo restores the recorded
content only when the current hash matches, otherwise reports the external change.

**Step 4.6 Unmappable selection** (E4.6, S)
Inspector explains the origin and offers the nearest editable ancestor or owning instance.

**Step 4.7 Structural edits** (E4.7, M)
Move, duplicate and delete in the layers tree map to JSX moves, copies and removals; unused
imports removed after delete.

### Phase 5: M3 Many screens

**Step 5.1 Canvas transform and navigation** (E5.1, M)
Pan and zoom from S1 in the real app; zoom presets, zoom to fit, zoom to selection.

**Step 5.2 Layout file and multiple frames** (E5.2, L)
`designs/<flow>/canvas.json` schema in contracts; server reads and writes it formatted; every
screen in a flow mounts as a frame at its saved position; drag and resize persist.

**Step 5.3 Screen lifecycle** (E5.3, M)
Create (blank or template), rename, duplicate, delete through the server; layout file updated.

**Step 5.4 Frame chrome** (E5.4, S)
Name and preset labels, snapping, align and distribute.

**Step 5.5 Virtualisation** (E5.5, M)
Unmount or pause offscreen frames; 12 mounted screens keep a steady frame rate.
Check: M3 demo.

### Phase 6: M4 Real components

**Step 6.1 Catalogue extraction** (E6.1, L)
`CatalogueService` per spike S4; cached under the tool home keyed by package version and file
hashes; refreshed on change.

**Step 6.2 Palette** (E6.2, M)
Categories, search, previews from Storybook story iframes when available, default render otherwise.

**Step 6.3 Insert** (E6.3, M)
Drop into a container: add import, insert JSX with required props, select the new element.

**Step 6.4 Typed prop controls** (E6.4, M)
Dropdowns, toggles, steppers, inputs, React-node summaries with jump to child.

**Step 6.5 Extra palette sources** (E6.5, S)
Settings entries for additional packages or directories.
Check: M4 demo.

### Phase 7: M5 Agents

**Step 7.1 ACP package** (E7.1, L)
`packages/acp` on `@agentclientprotocol/sdk` 1.4.0: spawn, `initialize`, session methods,
notification stream, permission handler, client filesystem and terminal hooks. Only this package
imports the SDK. Effect wrappers with typed errors.

**Step 7.2 Launch configurations** (E7.2, M)
`packages/acp/configs/{claude-code,codex}.json` from spike S3 findings: command, args, env, auth
hint, model discovery. Acceptance test adds a third config without touching editor or server code.

**Step 7.3 Threads and prompting** (E7.3, E7.6, L)
Server: `ThreadService` with one ACP session per thread, cwd the target repo, streamed updates
projected into a thread read model and pushed over the subscription channel. Web: thread list,
transcript view with message chunks, thoughts, plans, tool calls; cancel per thread.

**Step 7.4 Permission requests** (E7.4, M)
Thread UI for permission prompts with remember-for-thread.

**Step 7.5 Design context** (E7.5, M)
Composer attachments: selected screen files, selected element location, frame screenshot
(captured by the host runtime via `html-to-image` or equivalent) as ACP content blocks.

**Step 7.6 Agent edits reach the canvas** (E7.7, S)
File writes from agents go through the same watcher and HMR path; per-turn changed-files list
with diffs from git.

**Step 7.7 Client filesystem and terminal for agents** (E7.8, M)
Serve read, write and terminal methods only inside the repo, using the path guard from 2.3.

**Step 7.8 Persistence and resume** (E7.9, M)
Threads and transcripts under `~/.ultrapaint/`; `session/load` where supported.

**Step 7.9 Modes and config options** (E7.10, S)
Generic selectors driven by advertised data.
Check: M5 demo.

### Phase 8: M6 Versioning and safety

**Step 8.1 Per-file lease** (E8.1, M)
All backend writes go through a keyed queue with content-hash preconditions; stale edits are
rejected and re-read.

**Step 8.2 Git panel** (E8.2, M)
Status, diff and commit through the server; branch shown in the header.

**Step 8.3 Turn checkpoint** (E8.3, M, stretch)
Snapshot before a turn; review and revert as one unit.
Check: M6 demo.

### Phase 9: M7 Desktop shell

**Step 9.1 Electron wrapper** (E9.1, L)
`apps/desktop` that bundles the server and loads the web bundle; native folder picker exposed
through a preload bridge behind a `platform` abstraction in `client-runtime`. No Electron
imports in `apps/web`.
Check: M7 demo.

### Phase 10: Checkpoint

**Step 10.1 Storage format verdict** (E10.1, S)
Memo in `docs/decisions/storage-format.md` with edit reliability, agent success rate, merge
behaviour and review readability, and a recommendation on TSX.

---

## 4. Order and parallelism

1. Phase 0 (1 day).
2. Phase 1 spikes in parallel (3 days wall clock), then step 1.5.
3. Phase 2 (M0), then Phase 3 (M1) serially. These define the API everything else uses.
4. Phase 4 (M2) and Phase 5 (M3) can proceed in parallel after M1.
5. Phase 6 (M4) after M2. Phase 7 (M5) can start at step 7.1 and 7.2 right after the spikes
   and merge into the UI after M1.
6. Phase 8, 9, 10 in order.

## 5. Risks carried into the plan

- **Vite 8 / rolldown plugin surface.** Vite plugins written for Vite 5 or 6 may not work. S2
  checks this first.
- **Effect 3 versus T3 Code's Effect 4 rc.** We copy structure and conventions, not code.
- **Adapter churn.** Both ACP adapters are pre-1.0. Launch configurations are data so bumps are
  cheap, but S3 must be re-run on each bump.
- **Base UI generic prop types.** Catalogue extraction may need a hand-maintained override file
  for a minority of components. S4 measures the gap.
- **`data-*` stamping in production paths.** Stamping is dev-only and restricted to the designs
  directory and `ui/components`, so product bundles are unaffected.

---

## 6. Execution status (2026-09-17)

| Phase | Status | Notes |
|-------|--------|-------|
| 0 Bootstrap | done | Repository initialised; `products/prime/designs` package created in epicparty (uncommitted). |
| 1 Spikes | folded into the build | Findings in `docs/feature/spikes/findings.md`; ADRs in `docs/adr/`. |
| 2 M0 Foundations | done | Workspace, typed wire contract, settings with path guard, project header. |
| 3 M1 Walking skeleton | done | Host inside the target repo, discovery and watch, frames, HMR, fiber-based layers, two-way selection, inspector with provenance. |
| 4 M2 Edit loop | done | Classes, props, tokens-first pickers, inline text, undo/redo, unmappable selection, structural edits. Round trip ~0.7 s (formatter-bound). |
| 5 M3 Many screens | done | Pan/zoom, `canvas.json`, lifecycle, chrome with snapping, viewport virtualisation. Align/distribute not built. Frame-rate budget not measured. |
| 6 M4 Real components | done | Catalogue (325/327), palette with click-to-insert, typed prop controls, extra source dirs via settings. |
| 7 M5 Agents | done | ACP package, data-only launch configs, threads, streaming, permissions, context attachments, parallel threads, edits reach the canvas, persistence and `session/load`, generic modes/options. Codex verified to the model boundary (usage limit on the account). |
| 8 M6 Versioning | done | Per-file lease, git status/diff/commit panel, agent turn checkpoints with diff and revert. |
| 9 M7 Desktop shell | done (dev boot) | Electron runs the bundled server and loads the built web bundle; folder picker through the preload bridge. Packaging into an installer is not done. |
| 10 Checkpoint | done | `docs/decisions/storage-format.md`: keep TSX. |

### Open items

- Formatter latency: run Biome in-process or through a long-lived daemon to reach the 300 ms budget.
- Desktop: package the Electron app (electron-builder or similar); today it runs from the checkout with `pnpm -F @ultrapaint/desktop dev`.
- Canvas: align and distribute; scripted frame-rate measurement with 12 frames.
- Deviations from D6: Biome recommended rules instead of ultracite; plain Vite instead of vite-plus for this repository.
