# Plan: one `/sync` for the design system, whatever the project starts from

Status: proposed, 2026-10-06. Builds on ADR 0015 (the design system is imported by an agent),
0016 (Figma import) and 0023 (design-system setup). Will be recorded in two ADRs: 0024 (style
systems) and 0025 (sync and the configuration file).

## Why

A repository with its app in `front/` and its components in `front/src/components` opened
with no components, a Figma import ran against none, and `/init` could not fix it:

- `detect` (`packages/framework-react-vite/src/detect.ts`) only proposes a component library
  that is a package of its own, with dependents or React as a peer. Components inside the app
  are never proposed, so an unsaved session adopts `libraryDirs: []` without saying so.
- The agent has no way to change the settings, so it wrote `ultrapaint.json` by hand, with
  paths relative to the wrong directory (`src/components`, no `resolveFrom: "front"`, a guessed
  `hostCss`).
- An unsaved session never looks for a configuration file appearing; the settings service
  watches the file only when it started from one. The file had no effect until a restart.

Beyond the bug, the user has to know which of the first-run form, `/init`, the step-by-step
setup and the Figma import to use, and in which order. The project has four starting points
and one ongoing need:

1. Nothing: no code, no design system.
2. Code only: components and colours in the app, no design system.
3. A Figma file, with or without code: the design system comes from Figma, and is then applied
   to the code or used to scaffold it.
4. Code and a design system that drift apart over time, in either direction.

## Decisions

| # | Decision | Choice |
|---|---|---|
| S1 | Entry point | One `/sync` (and a **Sync** button in the Design system panel) that reads what exists, picks the case and shows a plan. The user does not choose between commands. `/init` stays as a shortcut for "adopt the theme as it is". |
| S2 | Source of truth for values | The code. A token's value lives where the style system declares it (`@theme` for Tailwind v4); `design-system.json` keeps its meaning (groups, descriptions, components, `DESIGN.md`) and no longer a copy of the value. Code ↔ design-system drift of values then cannot happen. |
| S3 | Styling | Tailwind v4 is the only style system implemented, but everything sync reads or writes goes through a `StyleSystem` adapter speaking neutral tokens, so StyleX or Emotion are a new adapter, not a refactor. |
| S4 | Figma | Import is first-class: sync offers it first when there is no design system, and importing a newer `.fig` is how Figma changes reach the code. Export to Figma is out of scope; the neutral token model leaves room for it. |
| S5 | Settings are not the agent's | Wiring is done by fixed rules and confirmed by the user in the editor. No agent writes the configuration file, and no new MCP tool is added for it (the tool budget is ~3 characters under its limit). |
| S6 | Configuration file name | `ultrapaint.config.json`, with `ultrapaint.json` still read. See phase 1. |
| S7 | One setup UI | The Design system panel's Setup view becomes the Sync view: the plan as a checklist. The five setup steps of ADR 0023 are what sync runs for the "from code" case, not a second, parallel flow. |

Open, to settle before the phase that needs them:

- When Figma and the code both changed a token differently: ask every time (default), or let
  Figma win. Phase 5.
- The scaffold's components: a template shipped with the tool (offline, deterministic;
  recommended) or generated with the shadcn CLI. Phase 6.

## The configuration file name

`ultrapaint.config.json` says what the file is next to the designs' own JSON
(`design-system.json`, `canvas.json`, `*.page.json`), and follows `vite.config.*`,
`tailwind.config.*`. It leaves room for an `ultrapaint.config.ts` should the configuration
ever need code. The cost is low: one constant (`CONFIG_FILE_NAME` in
`packages/contracts/src/settings.ts`), the lookup in `apps/server/src/storage-resolve.ts`, the
save path, the docs. The old name keeps working:

- In each directory from the working directory up, `ultrapaint.config.json` is looked for
  first, then `ultrapaint.json`. Both in the same directory: the new one wins, and the server
  warns once.
- A file loaded under the old name is kept under it: the server never renames a committed file
  by itself. It logs that the name is deprecated; Settings shows a **Rename** action that
  renames the file and keeps the session on it.
- Saving an unsaved session writes the new name. `--config` takes any name, as now.

## Phases

Each phase ends with `pnpm typecheck`, `pnpm test` and `pnpm lint` passing, and is one commit or
a few. Phases 1 and 2 have no dependency on each other; 3 needs 1; 4 needs 2; 5 needs 3 and 4.

### Phase 1: wiring (fixes the `front/` repository)

1.1 **Rename the configuration file** as above: `CONFIG_FILE_NAMES` (new first, legacy second)
in contracts; `resolveStorage` checks both per directory; `persist` writes the new name; the
returned start command, `bin.ts` help, `scripts/command.ts`, README, ADR 0010 updated; this
repository's own file moved with `git mv`. Tests in `storage.test.ts`: new name found, legacy
name found, both present, `--config` with either.

1.2 **Detect components inside the app.** When no library package scores, `detect` proposes the
anchor's own component directory: the first of `src/components/ui`, `src/components`,
`components/ui`, `components`, `src/ui` under the anchor that holds component files. It is a
library suggestion with no package name, so `applySuggestions` sets `libraryDirs` and leaves
`componentPackages` empty. A `detect.test.ts` fixture mirrors the failing repository: a root
without React, `front/package.json` with React and Vite, `front/src/components/*.tsx`,
`front/src/index.css` with `@import "tailwindcss"`. Expected: anchor `front`, library dir
`front/src/components`, the stylesheet found.

1.3 **In-app components get an import specifier.** `specifierFromPackage` returns null for an
app with no `exports` and no path alias, which drops every component of such an app from the
catalogue. Fall back to a specifier the preview can resolve from the anchor (a path from the
anchor's root, as Vite resolves `/src/components/button`). Verify with the 1.2 fixture that the
catalogue lists the components, and in the real `front/` repository that a page renders one.

1.4 **Say when nothing was found.** An unsaved session that adopts detected settings with no
library directory logs it, and the Design system panel shows "No components found" with the
settings fields to fill in (the existing setup fields in a plain popover, not a new form).

1.5 **A configuration file that appears is followed.** An unsaved session watches the
repository root for either file name; when one appears and validates, the session is promoted
to it (`storage.promote`) and the project reopens with it, as a saved session already does on
change. An invalid file is reported and ignored, as now.

1.6 **Agents stop instead of guessing.** `/init`, `/import-figma` and the setup tasks check the
catalogue first: with no component directory configured or no components found, the task tells
the agent to tell the user to open the Design system panel (or run `/sync`) and to stop. The
briefing says the configuration file is the user's and is not to be written by agents.

Done when the `front/` repository opens with its components listed and a page renders one,
without a configuration file and without a restart.

### Phase 2: the `StyleSystem` seam (no change in behaviour)

2.1 **Neutral tokens in contracts.** `TokenSource`: tokens with a name (`color-primary`, the
name pages already use as `$color-primary`), a kind (colour, spacing, font size, radius,
shadow, …), a value per theme, and where each is declared (file, span) so it can be written
back. Plus what the scan could not read, as notes.

2.2 **The interface** in `packages/framework-api/src/node.ts`:

```ts
interface StyleSystem {
  readonly id: string; // "tailwind-v4"; later "stylex", "emotion", …
  readonly detect: (root: string, anchorDir: string) => StyleSystemSuggestion | null;
  readonly readTokens: (ctx: StyleContext) => TokenSource;
  readonly writeTokens: (ctx: StyleContext, changes: readonly TokenChange[]) => readonly FileEdit[];
  readonly previewCss: (ctx: StyleContext, tokens: TokenSource) => PreviewStyles;
  readonly usage: UsageReader; // moved from Framework, unchanged
  readonly codeRules: string;  // how a token becomes code, for agents
}
```

`Framework` keeps what is React and Vite (catalogue, preview, app detection) and gets the style
system from settings. Pure and synchronous, like the rest of the framework package.

2.3 **The preview contract is CSS custom properties.** A page draws `$color-primary` as
`var(--color-primary, …)` today (`packages/design-document/src/tokens.ts`). That stays the
contract: `previewCss` makes sure the preview defines a custom property per token. Tailwind's
is the host stylesheet it already loads (`hostCss`); a StyleX or Emotion adapter would
generate one from `readTokens`. The renderer and the page format do not change.

2.4 **Move Tailwind into `packages/style-tailwind-v4`**: `design-system-scan.ts`,
`usage-scan.ts`, `usage-rewrite.ts`, the Tailwind half of `detect.ts`, and
`IMPLEMENTATION_RULES` from `apps/server/src/services/threads/commands.ts` as `codeRules`.
`writeTokens` is new: it edits a declaration inside `@theme`, or adds one to the block.

2.5 **Settings get `styleSystem`** (default `"tailwind-v4"`, proposed by detection). `hostCss`
stays where it is for now and is read by the Tailwind adapter; moving it under a `style`
section is left to the first second adapter, with the configuration's `$schema` versioned
then.

Known Tailwind assumptions left in place, to move behind the adapter when next touched:
`packages/design-document/src/code.ts` (the Code tab), the Tailwind checks in
`design-system-setup-rules.ts`, the wording of the briefing.

Done when every existing test passes unchanged and `@theme` is only read or written inside
`packages/style-tailwind-v4`.

### Phase 3: `/sync`

3.1 **What exists** (`SyncState`, server, rules): the app (anchor, component directories,
catalogue size), the style system's tokens, the saved design system, the Figma imports, and
the last sync's baseline.

3.2 **The plan** (`SyncPlan`): the case and its ordered steps, each step one of: confirm
settings, scaffold, Figma tokens, inventory, define (adopt or propose), map, migrate, verify,
describe, import frames.

| Found | Case | Steps |
|---|---|---|
| no app | from scratch | scaffold → define (propose) → verify; or, with a Figma import, Figma tokens first |
| app, no design system | from code | inventory → define → map → migrate → verify (ADR 0023; map and migrate offered, not forced) |
| Figma import, no app | from Figma | Figma tokens → scaffold with them → import frames |
| Figma import and app | Figma onto code | Figma tokens → reconcile with the code's → map → migrate → import frames |
| app and design system | keep in sync | describe what changed; with a newer Figma import, Figma tokens and reconcile |

Settings that do not validate, or an app with no components found, put **confirm settings**
first in every case.

3.3 **The Sync view** replaces the Setup view: the case in one sentence, the plan as a
checklist, one **Run** that goes through the steps and stops at each gate as the setup does
now. Steps done by agents open their thread as the setup does; snapshots, stop, resume and redo
are ADR 0023's, extended to the new steps. With no design system, the view leads with
**Import a Figma file**, then **Build from the code** or **Start from scratch**.

3.4 **`/sync` in the composer** opens the Sync view and computes the plan; it does not start an
agent turn of its own. No new MCP tool.

3.5 **Describe** (keep in sync): the tokens the code declares that the design system does not
describe, the ones it describes that the code no longer declares (with where pages still use
them), and the same for components. An agent fills the gaps the way `/init` updates an existing
design system, asking where the meaning is the user's.

3.6 **A drift check on open**: the same reading as 3.1, by rules, after the project opens. When
it finds work, the Design system panel's tab shows a count and the Sync view says what changed
since the last sync.

### Phase 4: values live only in the code

4.1 `Token.value` in `design-system.json` becomes optional and is no longer written. On read,
`DesignSystemService` takes the values from `readTokens` and the meaning from the file; a token
the file describes but the code does not declare is reported by sync, not drawn from a stale
value. Existing files keep loading: their values are ignored where the code has the token.

4.2 The preview's fallback values (`tokenValues`) and the Figma import's token matcher read the
merged design system, so nothing reads a stored value any more.

4.3 **Editing a token in the panel** (read-only today): a value is changed in a popover next to
its swatch or specimen, written with `writeTokens`, snapshotted like a setup step, and the
preview follows through the stylesheet it already watches.

4.4 **The baseline**: `design-system.json` records the token values at the last sync, and the
Figma values when they came from an import, so phase 5 can tell which side changed. It is
committed, so a teammate's sync starts from the same point.

### Phase 5: tokens from Figma

5.1 **Spike** (timeboxed): `openfig-core` 0.4.1 knows `VARIABLE_SET`, `VARIABLE_COLLECTION` and
`VARIABLE`. Confirm from a real file that variables, their modes and aliases, and the colour,
text and effect styles can be read.

5.2 `packages/figma-import` reads them into a `TokenSource`: names normalised
(`Colors/Primary/500` → `color-primary-500`), modes as themes, aliases resolved and kept as
semantic tokens, text styles as the design system's text styles.

5.3 **Figma tokens** in sync: a three-way comparison per token of the baseline, the code and
the import. Changed on one side only: taken to the other with `writeTokens`. Changed on both:
an `ask_user` card per group of tokens, with the two values as options. Then the usual map and
migrate when the code needs bringing onto the new tokens.

5.4 Importing a newer `.fig` of the same file is recognised (by its name and its document), and
sync proposes Figma tokens and the frames that changed.

### Phase 6: scaffolding

6.1 A template of Vite, React, TypeScript and Tailwind v4 with a small set of components
(Button, Input, Select, Checkbox, Card, Badge, Dialog, Tabs, Toast), its `@theme` empty, shipped
with the tool.

6.2 Written at the repository root when it has no app, else in a directory the user names
(`app/` proposed); dependencies installed with the repository's package manager after the user
confirms, through the spawning handle. Wiring then runs by itself (phase 1), and the next step
is define (propose: a few questions on the brand colour, density and tone) or Figma tokens.

## Risks

- **Specifiers of in-app components** (1.3): apps resolve imports through aliases, `baseUrl`,
  or Vite's root. The fallback has to match how the preview resolves, or components list but
  do not render. The real repository is the check.
- **Moving files between packages** (2.4) touches the setup's tests and the catalogue worker's
  imports; it is mechanical but wide. Done in one commit with no behaviour change.
- **Figma's variable encoding** is undocumented; 5.1 may find it partial. Styles alone still
  give colours and text styles.
- **Writing tokens back** to code the user edits concurrently: every write goes through a
  snapshot, and `writeTokens` refuses when the declaration's span no longer holds what it read.
- **The baseline in a committed file** can conflict on merge. It is one JSON object keyed by
  token, sorted, so conflicts are line-level and readable.
