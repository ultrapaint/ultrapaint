# Plan: deeper modules, the third review (2026-10-28)

Status: planned, 2026-10-28. Steps 1 to 8 are to be built one commit each, written under "Built" as
they land; "To investigate" is looked at one candidate at a time before anything of it is planned.
The decisions are recorded in [ADR 0039](adr/0039-deep-modules-third-review.md). Follows
[ADR 0037](adr/0037-deep-modules.md) and [ADR 0038](adr/0038-deep-modules-second-review.md), whose
31 steps ([PLAN-architecture.md](PLAN-architecture.md), [PLAN-architecture-2.md](PLAN-architecture-2.md))
are not proposed again. The terms are in `GLOSSARY.md`.

## Why

A third review, over the whole repository, found concepts still written in several places, and
rules that live in one big file with no test reaching them. Where copies drifted, the review
traced a bug by reading the code (not reproduced; each step writes the failing test first):

- the task texts name the editor's tools by string about 51 times, past `agent-ways`, so with
  the MCP server off Define, `/components` and `/sync describe` still tell the agent to call
  `ask_user` and `write_design_system`;
- the inspector and the element toolbar each read and write about ten node fields by hand, and
  their align disagrees (one writes `"start"`, the other `null`; a mix shows "Mixed" and "Left");
- three modules write a frame's host, and reopening a parked frame wipes a `dark` class the
  page's code put on `<html>`;
- checkpoints kept a format of their own: a revert bypasses the edit journal (not undoable),
  says nothing of a file it removes, and puts the comments back;
- Tailwind's scales, keywords and class grammar are written in four files of the style adapter,
  and no test reads a written class back;
- "the token with this value" is looked up four times with four equalities, so `#2b7fff` is no
  token in the usage inventory and `blue-500` in Sync;
- what the generated editor entry exports and the order it starts in are in string templates;
- the preview server's Vite config and its four plugins are assembled in a script no test imports.

Each step gives one concept one module with an interface its callers and its tests share, and
keeps every ADR's behaviour unless the step says otherwise.

## Steps

### A. Server

1. **The editor's tools, named once for the agent.** Every tool a task text, the briefing or a
   service's message tells an agent to call is named through `agent-ways` (or the module it
   grows into), which knows whether the editor's toolkits are offered and says what the text
   asks for in their absence (answer in the reply and end the turn rather than `ask_user`; write
   the files by hand rather than `write_design_system`; or refuse what only a tool can do). A
   name is the tool's own (`Tool.make`'s), so renaming a tool fails to compile or fails a test,
   as `HANDOFF_ACTIONS` already does for the handoff's actions. No literal tool name is left in
   `page-tasks`, `setup-tasks`, `sync-tasks`, `tasks`, `briefing` or `implementation`. One test
   over every task request, on `ProjectTest` with the MCP server on and off: every tool a text
   names is in the offered toolkits, and none is named when they are not. The tool listing's
   character budget (`mcp.test.ts`) is not touched.
2. **Checkpoints in the snapshot store.** A turn's checkpoint is a ref of a third namespace of
   the snapshot store (beside `designs` and `setup`): one format, one garbage collection (its
   last-30 rule kept as the namespace's), content kept once. A revert puts the designs back as a
   snapshot's restore does, through `EditService.transaction` (one undo step), publishing
   `file.changed` for what it writes and what it removes. The comments file is left out, as a
   snapshot leaves it (decided 2026-10-28: reverting a turn never deletes comments written
   since). `openRepo`/`ours` and `simpleDiff` are written once; `Snapshots.create(name,
   checkpoint)` names a ref rather than converting a format. The checkpoints kept in the old
   JSON files are moved in once, as `importOld` does for snapshots. Tests on `ProjectTest`, off
   the socket: a revert is undone in one step, a removed file is published, comments survive a
   revert, two turns share content. Amends ADR 0008.

### B. Packages

3. **Tailwind's utilities, one vocabulary in the adapter.** One module of `style-tailwind-v4`
   knows Tailwind's utilities: how a class splits into variants, utility, value, arbitrary value
   and its type hint and `!`; the default scales (text sizes, weights, radii, shadows, with the
   weights' numbers); the keywords both ways (`full` ↔ `100%`, colour keywords). The Code tab's
   writer (`node-classes`), the spec reader (`component-spec`), DESIGN.md's component reader
   (`component-style`) and the usage inventory (`usage-classify`, `usage-vocabulary`) call it;
   their tables and regexes go. A round-trip test over the fixtures: a node's declarations
   written as classes and read back as spec fields give the same values. Behind ADR 0024's seam;
   no ADR changes.
4. **The token with this value.** The token table answers which tokens of a kind hold a value,
   by token-value's `sameValue`. Figma's paint matching, the usage inventory, the usage rewrite
   and the Sync engine call it and keep only their tie-break (Figma and the inventory: the first
   in the design's order; Sync: one match only). Figma matches in every colour space (decided
   2026-10-28): an oklch token now matches a Figma hex of the same colour. The web's leftover
   arbitrary-class check (`[` in a field's value) goes or reads the lookup. One table test in
   contracts (hex, oklch, named colours, rem against px, shadows); the callers' tests check
   their policy. Applies ADR 0037's "one notion of the same value".

### C. Web

5. **A node's fields, one table for the inspector and the toolbar.** A pure module over
   `DesignNode` declares each field both surfaces edit (align, text style, colour, fill, tint,
   radius, shadow, gap, props, and whatever else both draw): how several nodes' values are read
   as one (with the field's default, `MIXED` when they differ), what a value written means
   (what counts as unset), its undo label and its options (token options built once). The
   inspector and the element toolbar draw it; their read/write pairs, the second colour-token
   list and the `as unknown as Record` casts go. Fixes align: unset and `"start"` are one
   value, written as unset. Table tests over node fixtures, where neither surface had a test.

### D. Preview

6. **The frame's host, the core's.** preview-core owns a frame's host element. The editor says
   how a frame is shown (its class, style, title, whether it takes input, whether it is away)
   through the frame runtime, and the core keeps what the page's code writes to `<html>` and
   `<body>` (classes, single style properties) apart from it, so neither wipes the other.
   `editor-frame`'s `present()` and its pointer-events writes go to the core; "is this event
   from a frame" has one rule (the core's registered frames), which `keys.ts` uses. The scripted
   renderer of `frame.test.ts` becomes a shared test adapter, and `editor-frame.test.ts` runs
   against the real `createPreview` in happy-dom. Fixes a page's `dark` class lost when its
   parked frame is opened again. Amends ADR 0034 (who owns the host).
7. **The preview server's config, a module.** One function of `framework-react-vite` builds the
   preview server's Vite config from its options and a loaded Vite: the inherited config, the
   plugins in their order and `enforce` (`patchedClient`, `publicUrls`, `guardedCode`,
   `serveAsset`), the virtual ids. `serve.ts` keeps reading argv, loading Vite, listening and
   stopping. Tests run Vite in middleware mode over `fixtures/sandbox-host` and call
   `transformRequest`: the repository's code is guarded, a dependency gets the loop checks
   only, public URLs are prefixed, the client is patched, `virtual:ultrapaint/guard` loads.
   The hard-coded `"editor.ts"` and `"components.ts"` read `EDITOR_FILE` and `COMPONENTS_FILE`.
8. **The editor entry, declared.** `framework-api/browser` declares what the generated editor
   entry exports (`preview`, `onReloadRequest`) and what the editor bundle exports
   (`createPreview`, `installHooks`, `onReloadRequest`); `build.ts`'s list and the web's private
   `PreviewModule` read it. preview-core gives one start-up call that installs the hooks, creates
   the preview once the modules have run and wires Vite's `vite:afterUpdate` and `vite:error`,
   so the template shrinks to its imports and that call, and the order is stated in code once
   (the comments in `preview-files.ts` and `kernel.ts` go). A test reads `previewFiles()`'s
   output for the names it exports and imports; the start-up order gets a happy-dom test.
   Amends ADR 0011 and 0037's page-runtime line; the framework seam stays.

## To investigate

Each is looked at by itself, in this order, before anything of it is planned: does the friction
hold up, what would the module be, what is the smallest step.

1. **Naming a token from another tool, and placing it by kind** (`apps/server/src/services/dtcg.ts`,
   `packages/figma-import/src/tokens.ts`, `packages/style-tailwind-v4/src/design-system-scan.ts`,
   contracts' `token-table`). Three readers keep their own words for a kind: DTCG's
   `GROUP_KINDS`/`TYPE_KINDS`, Figma's `NUMBER_KINDS`/`KIND_WORDS`, the scan's `NAMESPACES` (a
   copy of the token table). Figma's `Corner/sm` is `radius-sm` from a `.fig` and `corner-sm` of
   no kind from a DTCG export; the scan drops `--inset-shadow-*`, `--drop-shadow-*` and
   `--text-shadow-*`, which `tokenKindOf` calls shadows.
2. **What a page frame draws, and when it is drawn again** (`canvas/frame.tsx`,
   `canvas/prototype.tsx`, the specimens of `panels/design-system.tsx` and
   `panels/design-components.tsx`): the render input, the hand-kept dependency lists, the host
   errors' lifecycle; with the page error's six declarations and the frame events listed by hand.
3. **Frame gestures on the canvas** (`canvas/canvas.tsx`, `state/editor.ts`): moving and sizing a
   frame and sizing a node on the canvas, where a cancelled pointer saves the move, Escape does
   not cancel, and the order of saves leaks to the caller.
4. **A design target** (`implementation.ts`, `page-tasks.ts`, `handoff-tools.ts`, `comments.ts`,
   `specs.ts`): "a page or a spec" named by three rules in four places, and behaviour notes
   stored two ways.
5. **The desktop window** (`apps/desktop/src/main.ts`, `preload.ts`, `stuck-pages.ts`): the
   stuck-page watch, the title bar, the navigation policy, the view's URL and the quit sequence
   behind a port with Electron as its adapter.

Smaller, looked at alongside the nearest of these: the Changes panel's history as a followed store;
one `reveal(target)` verb on the canvas; `ThreadService`'s forwards and `setAgent`'s busy check
outside the session's permits; one watch of each frame's host; the setup's `revertBatch` past
`SetupSteps`; `mountFrame`'s closure; the leftovers of ADR 0038's flows (`checkMapping`, the
scaffold's theme in a handler, the MCP endpoint built twice, `designTokensSide` used only by its
test, `server.test.ts`'s socket tests that `ProjectTest` could run).

## Built

1. **The editor's tools, named once for the agent** (`apps/server/src/services/threads/agent-ways.ts`).
   `ToolName` is the name of every tool the MCP server offers, read from the toolkits' types
   (`EditorTools`, `FigmaTools`, `SetupTools`) and the two tools registered on the server itself
   (`AskUser`, `GetScreenshot`, now exported); `ToolNames` maps each to itself, and the one
   record of them fails to compile when a tool is renamed, added or taken out. `AgentWays.tools`
   is that record with the server and null without it (it was a boolean), so a text that names a
   tool has checked the tools are there: Map, Migrate, `/import-figma`, `/sync figma` and `/sync
   design`, which refuse without them, take the names from it, as do the steps that only one
   task words (Adopt's look at a page, `/components`' pages and frames, a draft's instances, the
   briefing's warning on `fill`). `handoffCall` reads the tool's name too. What several texts ask
   is worded both ways in a capability: `askUser` (with `ask_user`, or in the reply, ending the
   turn), `readDesignSystem`, `readComponent`, and `readTheme` and `saveDesignSystem`, which are
   steps' texts now that Define's proposal and `/sync describe` use them too. The literal names
   in `page-tasks`, `setup-tasks`, `sync-tasks`, `tasks`, `briefing` and `implementation` go,
   and the style system's code rules no longer name `list_pages`. Also: without the MCP server,
   Define's proposal reads the theme itself, asks in its reply and writes the design system's
   files by hand; `/components` writes the pages' files (with the page format), leaves the frames
   to the user and does not look at screenshots; `/sync describe` reads the files and the
   components' code, asks in its reply and writes the files by hand; `/sync code` asks in its
   reply; Adopt reads the page's file; a draft's instances are changed in the pages' files; the
   briefing no longer says `apply_operations` warns; and `/init` and Define tell of a design
   system imported before (the paragraph was dropped). With it, Define's proposal and `/sync
   describe` save with `write_design_system`'s whole instructions, and a DESIGN.md is pointed to
   by its path rather than by `read_design_system`. Left as they are: the built-in skills
   (layout, components, color) name `get_screenshot`, `set_frame`, `get_component` and
   `read_design_system`, and the answers of tools that only an agent with the tools reads
   (`figma-import`, `design-md`, `design-system-setup-batches`, the MCP instructions) name tools
   by string. `tasks.test.ts` has 2 more tests, over requests of every kind (a kind left out does
   not compile) on `ProjectTest`, before and after a project has a design system with DESIGN.md,
   tokens changed on both sides, a Figma file, a draft component and Map under way, with the
   briefing for each purpose and the skills left out: with the MCP server every tool a text
   names is one it offers, and only `/design-system inventory` is refused; without it no tool is
   named, and exactly the five that need the tools are refused. The second failed first, with
   tools named 34 times in Adopt, `/components`, both Implement tasks, Define's proposal, `/sync
   describe` and the briefing; four `notInclude` checks it covers go.
2. **Checkpoints in the snapshot store** (`apps/server/src/services/design-refs.ts`,
   `threads/checkpoints.ts`). A turn's checkpoint is a ref of the snapshot store's `checkpoints`
   namespace, named by its id, whose note is the `Checkpoint` the Changes panel lists and the
   repository it was taken in; a file unchanged from one turn to the next is kept once, and the
   last 30 (of every repository, as before) are kept by letting go of the oldest refs and
   collecting. `makeDesignRefs(namespace, note)` is what a named snapshot and a checkpoint share:
   the design files now (the comments left out), the refs of the open repository (`openRepo` and
   `ours` once), finding one, keeping files or naming a snapshot the store has, the diff with now
   (`simpleDiff`'s loop once), putting one back through `EditService.transaction`, and moving an
   older format's JSON files in (`importOld`, once for both). `SnapshotStore.name` keeps a
   manifest it has under another ref, so `Snapshots.create(name, checkpoint)` names the
   checkpoint's files rather than copying them, and `Checkpoints.files` goes for `find`. Also: a
   revert is one undo step ("Revert to the checkpoint …"), publishes `file.changed` for every
   file it writes or removes (the designs' watcher told only of pages and the files it follows),
   and leaves the comments file as it is; a checkpoint no longer keeps the comments, and one
   moved in from `<state>/checkpoints/*.json` drops them (one that does not read stays, and the
   log says why); `checkpoints.revert` fails as `snapshots.restore` does (`EditError`), and the
   Changes panel's confirmation says undo takes it back and the comments stay; a checkpoint's
   diffs come in path order. `ProjectTest` can write files into the state directory before the
   server starts. `checkpoints.test.ts` has 7 tests on `ProjectTest`: compared and reverted,
   then undone in one step; a component the revert removes is published; comments written since
   survive; two turns keep a file's content once; kept as a snapshot, the same manifest under
   two names; the last 30; the old format moved in. All seven failed first (the undo found no
   step, the removal was never published, the comments were in the diff). The socket test of a
   revert in `threads.test.ts` goes; `thread-session.test.ts` breaks the store rather than the
   checkpoints directory to fail a turn's checkpoint.
3. **Tailwind's utilities, one vocabulary in the adapter** (`packages/style-tailwind-v4/src/utilities.ts`).
   `parseClass` takes a class apart into its variants (brackets and parentheses kept whole), a
   `!` before or after, its sign and its utility, and `printClass` puts one back together;
   `utilityReader(names)` reads a utility as the longest of a reader's names and its value;
   `splitModifier` takes a colour's opacity off; `arbitraryOf` reads `[…]`, `(--x)` and
   `(type:--x)` as CSS with its type (an underscore a space, but in a URL), and `printArbitrary`
   writes one. `TEXT_STEPS`, `WEIGHT_STEPS` (with each weight's number, `weightStepOf` the other
   way), `RADIUS_STEPS` and `SHADOW_STEPS` are Tailwind v4's default theme; `SIZE_KEYWORDS`,
   `SCREEN_KEYWORDS` (by axis) and `COLOR_KEYWORDS` give a keyword's CSS and a value's keyword.
   The class writer (`node-classes`: its weights, its length, screen and colour keywords, its
   arbitrary values and variants), the spec reader (`component-spec`: its `CLASS_RE`, `split`,
   hint, variable and `!` patterns, scales and keywords), DESIGN.md's reader (`component-style`:
   its `CLASS_RE`, brackets and `!`) and the usage inventory (`usage-class`'s splitting,
   `usage-classify`'s default scales and arbitrary values, `usage-vocabulary`'s utilities no
   longer sorted by hand, `usage-rewrite`'s class put back) call it, as does the canvas test in
   place of its own splitter; what a class means stays each reader's. Where the copies
   disagreed, Tailwind v4 decides, each with a test that failed first: the spec reader reads
   `h-screen`, `h-dvh`, `w-screen` and `w-dvw` (which the writer writes), a variable with its
   type (`border-(length:--x)`, `text-(length:--x)`, which the writer writes for a token of
   another namespace) and a `!` after a variant (`hover:!bg-accent`); DESIGN.md's reader reads a
   class whose brackets hold a colon, a slash or a type (`bg-[color:var(--x)]`,
   `text-[rgb(0_0_0/0.5)]`: it skipped any class with `:` or `/`), keeps a typed value to its
   type, takes an underscore for a space and `bg-(--x)` for `bg-[var(--x)]`; the writer writes
   `#000` and `#fff`, Tailwind's values of `black` and `white` that the spec reader reads them
   as, as `bg-black` and `bg-white` (`#ffffff` stays a value); the inventory reads `(color:--x)`
   as the token it names, and a bare `rounded-t` or `border-x` as that utility rather than
   `rounded` with a value `t` (which it classified as nothing). Left: the inventory's layers
   (`z-0` to `z-50`) and the colours that are no decision stay `usage-classify`'s, which no
   other module reads; the writer still puts a size keyword on any spacing utility (`gap-full`
   for a `100%` gap, which Tailwind does not have). `utilities.test.ts` has 9 table tests: the
   grammar both ways, the scales and the weights' numbers against `tailwindcss/theme.css` (its
   deprecated block left out), the keywords both ways; `usage-scan`'s class test keeps what the
   scan's own utilities decide. `canvas-and-code.test.ts` reads the Code tab's classes back:
   over every page of the fixtures and designs, a node's base declarations the spec models
   (fill, colour, font size and weight, gap, width, height, opacity, padding by side, border
   width, style and colour, radius, shadow), written by the writer and read by `componentSpec`,
   come back the same, about 14,000 fields, a step compared as its pixels and a weight's name as
   its number; left out are the breakpoints, margins, minimum and maximum sizes, layout, line
   height, tracking, font family, text align, a side's border or a corner's radius, and a value
   a property starts at, which the writer does not write.
