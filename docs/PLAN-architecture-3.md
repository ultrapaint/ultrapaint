# Plan: deeper modules, the third review (2026-10-28)

Status: steps 1 to 18 built, 2026-10-28, one commit each, under "Built". Steps 9 to 18 were
planned from the candidates investigated one at a time ("Investigated").
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

### E. The candidates investigated

Planned 2026-10-28 from "Investigated" below, with the user's answers (the recommended ones).

9. **A token from another tool, named and placed once.** contracts' `token-naming`, beside the
   token table, says what kind a path another tool writes names, and the design's name for it,
   from the path and a hint of what the value is: the words each kind goes by elsewhere
   (`corner`, `rounded`, `radii`; `gap`, `padding`, `space`; `stroke`), each kind's words checked
   against the table so a new kind fails to compile. The format's type decides wherever it says
   what the value is (colour, shadow, font family, duration, cubic Bézier); the path's words
   decide only for a dimension or a number, a number of a length kind read in pixels. A name drops
   only the found kind's own words (`Color/Text/Primary` is `color-text-primary`, `Rounded/lg` is
   `radius-lg`); gap, padding and margin name spacing and stay in the name (`spacing-gap-md`).
   Figma's reader and the Design Tokens reader give it a path and a hint and keep their syntax;
   `NUMBER_KINDS`, `KIND_WORDS`, `GROUP_KINDS`, `TYPE_KINDS` and `nameFromPath` go. The reader's
   notes of what it could not take reach the Design system panel rather than being dropped. The
   scan places a theme variable by `tokenKindOf` and the table's lists (`NAMESPACES` goes): the
   repository's own `--inset-shadow-*`, `--drop-shadow-*` and `--text-shadow-*` are shadows,
   Tailwind's defaults of those stay out as its palette does, and `default-transition-duration`
   is a duration. `dtcg.ts` stays in the server. Failing first: a Design Tokens file's
   `Corner.sm` (`dimension`) is `radius-sm`; Figma's `Color/Text/Primary` beside `Color/Primary`
   gives two tokens; a scan of a repository with its own `--drop-shadow-glow` lists it under
   shadows and `driftOf` finds nothing undescribed; `text.primary` of `$type: color` is a colour.
   Amends ADR 0025's naming.
10. **A frame's error, kept by the frame.** framework-api declares `PageError` once, with its
    source (the page's code or the dev server); `HostError`, `FrameError` and the inline copies
    go, and it is formatted once. `editor-frame` keeps a mount's error whoever listens: a page
    error until the frame draws again or an update arrives, a dev-server error until the next
    update, and frames off screen or parked hold it too; it is cleared when the frame is dropped.
    The canvas, the prototype and the stray-error toast read it. `eventsOf` and `forwardTo` are
    typed over every kind of `FrameEvents`, so a kind left out fails to compile. Failing first:
    an error reported with nobody listening is there when a listener comes; it survives a
    listener leaving and coming back; a draw clears a page error but not a dev-server one.
11. **What a frame draws, said once.** `useFrameDrawing(id, request)` draws a frame's request on
    `ready` and whenever the request changes, for the canvas, the prototype and the specimens
    (the type specimen, the components' matrix); `pageRequest` builds a page's request for the
    first two, a node held at its dragged size included (`drawResized` goes). The specimens'
    `ready` state and every `biome-ignore`d dependency list go. Failing first: a specimen's frame
    dropped and opened again draws again; the matrix draws again when a spec changes.
12. **Frame gestures, one module.** Moving and sizing a frame, and sizing a node on the canvas,
    are `frame-gesture`'s, which shares the window-following helper with `followLooseDrag`. It
    saves once on release (a rounded `setFrame`, or one node edit); `pointercancel` and Escape
    put any gesture back, a node dragged inside a page included, as a canvas node's drag does
    today. The `useRef` union leaves `Canvas`, and `setFrame`'s `persist` flag goes. Touch and pen
    stay out. Failing first, through `useEditor` and `fakeApi`: a cancel and Escape send nothing
    and put the frame back; a move sends one rounded `canvas.set`; a cancelled node resize sends
    no edit.
13. **The layout saved as it changes.** No timer: a frame's change is saved at once, sending only
    the pages that changed; a layout the server pushes applies to every frame without a save in
    flight; undo waits for the saves in flight. Failing first, with `fakeApi.emit("canvas", …)`:
    a push moving page B while A's save is in flight keeps B; `canvas.set` sends only A.
14. **Bringing something into view.** `reveal(target)` switches canvas, leaves the prototype,
    selects, and moves the camera once the frame is laid out; the seven places that select and
    zoom call it. Failing first: a thread's Show on a page of another canvas goes there.
15. **A design target, named once.** `designTargetNamed` beside `pageNamed` names a page or a
    spec for `/implement`, `handoff` and the implementation link: a bare component name or
    `spec:` names a spec (legal everywhere), otherwise the page rule, a node reference keeping its
    node (a node reference and a conflicting `node` refused); a miss says which kind is missing.
    `ImplementationService.current` takes canonical targets. `DesignTargets` reads and adds a
    target's behaviour notes whichever way they are stored. Failing first, on `ProjectTest`:
    handoff's `note` on `/home#<id>` lands on the node; `read`, `mark` and `note` with a bare spec
    name succeed; `/implement spec:Nope` names the specs.
16. **Agent switches and batch reverts wait for the turn.** `ThreadSession` decides a switch of
    agent under its `prompting` permit, refusing it while a prompt is accepted or a turn runs.
    `SetupSteps.revertBatch` stops the turn working on the batch first and waits for it to end
    (bounded), as redo does; the RPC goes through it. The MCP endpoint is built once, in
    `McpAccess`; `checkMapping` moves into `FigmaImportService.map`. Failing first: `setAgent`
    while a prompt is held answers a conflict and the thread stays running; reverting the active
    batch stops its turn before the files go back.
17. **A signal does not wait for an answer.** `OpenProject.stop({ ask: false })` answers "no" to
    a question on screen (a quit's or a switch's) and stops at once; `main.ts`'s `asking` goes.
    The stuck pages' beat is `BEAT_MS` beside `BEAT_CHANNEL`, which the preload and the stuck
    pages' test read. Failing first, on the existing fakes: with a confirm that never answers and
    a quit forked, the signal's stop returns and the server's stop is recorded; a switch's
    question cut short by a signal.
18. **The checkpoints and snapshots, followed.** The server publishes the open repository's
    checkpoints and snapshots from the snapshot store's writes (a state, not a ping); the web's
    store follows it like any server data, the Changes panel reads it, and its tickets and
    threaded refresh callbacks go. Git status stays read on `file.changed`. Failing first, on
    `ProjectTest`: a turn that writes nothing publishes a list with its checkpoint; a snapshot
    made and deleted publishes twice.

## Investigated

Each candidate was looked at by itself on 2026-10-28, after steps 1 to 8 were built, reading the
code and reproducing what could be reproduced in a scratch script. The bugs are the investigators'
findings; those marked "reproduced" were run, the others read. Nothing below is built; the steps
proposed are planned as steps 9 to 18 with the recommended answers, which the user took.

1. **A token from another tool** (`dtcg.ts`, `figma-import/src/tokens.ts`,
   `design-system-scan.ts`). Holds up, and is worse than the review said. Three vocabularies
   (DTCG's `GROUP_KINDS`/`TYPE_KINDS`/`nameFromPath`, Figma's `NUMBER_KINDS`/`KIND_WORDS`/
   `tokenNameOf`, the scan's `NAMESPACES`, a drifted copy of the token table). Reproduced: a DTCG
   `Corner.sm` (`dimension`) is `corner-sm` of kind `other`, which `addTokens` drops without a
   word (`design-system-files` drops the reader's notes); Figma's `Color/Text/Primary` is
   `color-primary`, colliding with `Color/Primary`, and Sync's rules take the same name as a sure
   match; the scan drops the repository's own `--inset-shadow-*`, `--drop-shadow-*` and
   `--text-shadow-*`, which `driftOf` then reports as undescribed right after `/init`. DTCG's group
   word also beats `$type` (`text.primary` of `$type: color` is a text size). Proposed step: a
   sibling of the token table in contracts, `token-naming`, says the kind a foreign path and
   value hint name and the design's name for it; Figma's and the DTCG reader keep their syntax;
   the scan places by `tokenKindOf` and `NAMESPACES` goes. `dtcg.ts` stays in the server.
   Questions: which words a name drops (recommended: only the found kind's own, so
   `color-text-primary`); gap, padding and margin as spacing kept in the name
   (`spacing-gap-md`); `$type` wins over the group word where it names a value type; inset, drop
   and text shadows stay shadows, the repository's own kept, Tailwind's defaults out; the DTCG
   reader's notes reach the Design system panel; `default-transition-duration` a duration.
2. **What a frame draws** (`frame.tsx`, `prototype.tsx`, the specimens). The canvas's and the
   prototype's redraw lists are complete; the friction holds, the bugs are elsewhere. A frame's
   error lives only while its view listens: panned away and back, its banner goes while the module
   is still broken, and frames off screen or parked never show it; the canvas and the prototype
   clear it at different moments. The specimens' `ready` state never goes back, so a specimen's
   frame dropped and opened again (the preview restarting) stays blank, and the components'
   matrix does not redraw when another spec changes. The error is declared six times; the frame
   events' fan-out compiles with a kind left out. The host's watching is fine. Proposed steps: a
   frame's error kept by `editor-frame` whoever listens, one `PageError`, the fan-out typed over
   every kind; then `useFrameDrawing` for the canvas, the prototype and the specimens (and
   `pageRequest` for the first two), the `biome-ignore` lists and `drawResized` gone. Questions:
   when an error ends (recommended: a dev-server error at the next update, a page error at the
   next draw or update); off-screen frames show a dev-server error (recommended: yes); the
   specimens in scope for the drawing only.
3. **Frame gestures** (`canvas.tsx`, `state/editor.ts`). Cancel and Escape are inconsistencies
   (three different cancel behaviours today) more than bugs. The save of the layout is where the
   bugs are: `applyLayout` drops a pushed layout while the save timer waits and `saveLayout` sends
   every frame of the canvas, so a page an agent's `set_frame` moved within about 400 ms of the
   user moving another goes back; a second drag soon after the first saves an unrounded position
   as an undo step; and the timer no longer has anything to coalesce. Proposed steps:
   `frame-gesture` owns moving and sizing a frame and sizing a node on the canvas, sharing the
   window-following helper with `followLooseDrag`; then the layout saved as it changes, only the
   pages changed sent, a push applied to every frame without a save in flight. `reveal(target)`
   is its own small step (a thread's Show on another canvas's page does nothing today).
   Questions: a cancelled pointer and Escape put a gesture back (recommended: yes, every gesture);
   the debounce goes (recommended: yes); touch and pen left out.
4. **A design target** (`implementation.ts`, `page-tasks.ts`, `handoff-tools.ts`). A page and a
   spec cannot collide (pages are named by file or URL), so the precedence decides nothing; the
   three rules still disagree: handoff's `note` on `/orders#c_8` lands on the whole page, a bare
   `Button` (which the Components panel sends) works for `/implement` and fails for `handoff`.
   Notes are read three times. Proposed step: `designTargetNamed` beside `pageNamed` and a
   `DesignTargets` service over specs, comments and the implementation link. Separately, two real
   bugs: `setAgent` checks busy outside the session's `prompting` permit, so switching the agent
   just as a prompt is sent can lose the prompt or show the thread idle while it runs; and Revert
   is offered on the setup batch Migrate is working on, past `SetupSteps`. Proposed step: the
   switch checked under the permit, `SetupSteps.revertBatch` stopping the turn first, the MCP
   endpoint built once in `McpAccess`, `checkMapping` in `FigmaImportService.map`. The other ADR
   0038 leftovers are fine. Questions: a bare component name legal everywhere (recommended: yes);
   reverting the active batch stops the turn then reverts (recommended) or is refused.
5. **The desktop window** (`main.ts`). No port: it would have one adapter, and the window's logic
   already sits behind `Shell` and `WatchedContents`. One real bug, reproduced on the real
   `OpenProject.layer`: a SIGINT or SIGTERM waits for an answer to a "stop the server?" question
   on screen, though the comment says it does not, so a logout hangs until someone clicks.
   Proposed steps: `OpenProject.stop({ ask: false })` answers an open question "no" and stops at
   once (with the stuck pages' beat shared as `BEAT_MS`); and the Changes panel's history
   followed: the server publishes the open repository's checkpoints and snapshots from the
   snapshot store's writes, the web's history store follows them, and the panel's tickets and
   threaded refresh callbacks go (a turn that writes no design file leaves its checkpoint off the
   list today, and a checkpoint pruned by the last-30 rule fails when clicked). The navigation,
   URL and path policies are fine (`serveWeb` contains `..` in every form tried; a malformed `%`
   throws in its handler).

## Follow-ups found while building

- `pnpm e2e:sandbox` fails 6 to 8 of its 23 checks, the same before steps 6 to 8 (checked on
  e9de144 in a separate worktree): a frame's keys, the repository's proxy, CSS-in-JS styles, the
  editor's variables, the prototype's click error, a loop in a click, and (flaky) a frame's width
  and scroll.

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
4. **The token with this value** (`packages/contracts/src/token-table.ts`). `tokensByValue(tokens)`
   is a lookup, `(kind, value)`, of every token of the kind that holds the value by token-value's
   notion of the same value, in the order the tokens were given (a design system's is
   `listedTokens`'s or `tokensOfKind`'s); a token's kind is its own where it says one (Sync's
   `SourceToken`), else its name's. Each token's value is read once and a value asked for again is
   answered from what was found: `sameValue` is now its two halves, `comparable` (the value read,
   a colour's sRGB worked out once) and `sameAs`, which the lookup calls. Each caller keeps only
   its tie-break: Figma's `makeTokenMatcher` takes the first colour token, and its `normaliseColor`
   (sRGB only, exact) goes; the usage inventory's `knownOf` has `colorsByValue` in place of
   `colorByValue` (text normalised, exact) and takes the first, `normaliseColor` staying only as
   how it lists a colour written out (the mapping's key); the usage rewrite's `tokenOfLength`
   (pixels, exact), its weights' trimmed text and its shadows' `sameValue` go for one rule over
   the design system's tokens, read once per `suggest`, the first; Sync's `matchByValue` asks the
   lookup and keeps one match only. On the web, `isArbitraryClass` (a `[` in a class) went: a
   field's values are document values since the inspector stopped writing classes, so a raw `13`
   or `#ff0000` was never marked. `isOutsideDesignSystem` says a value is outside when it is set,
   no token reference (`$…`) and none of the field's options (`16px` read as the spacing step
   `16`); `ValueField` gives it to the style combobox as `outside`, which marks the field and a
   typed value ("Use arbitrary"), and no longer checks the options, which never are. Also: an
   oklch token now matches a Figma hex of the same colour (decided 2026-10-28), `bg-[#2b7fff]` is
   Tailwind's `blue-500` in the inventory as in Sync, and Figma and the inventory take a colour
   within a step of 255 per channel (`#3b82f7` finds a token of `#3b82f6`), the rewrite a length
   within a hundredth of a pixel and a zero as any zero, as `sameValue` always did. A table test
   in `token-table.test.ts`: a hex and an oklch of one colour (both, in order), a named colour, an
   alpha, rem against px, a shadow spaced and cased otherwise, a weight, a kind mismatch, a kind a
   token says. Each caller's test checks its policy: the inventory's (the first of an oklch and a
   hex token) and Figma's (an `oklch(1 0 0)` token before a `#FFF` one) failed first, taking the
   hex token after it and the palette's white; the rewrite's takes the first of two radii; Sync's
   is `design-system-sync-rules`' one value. `value-field.test.ts` failed first (no check read a
   value); `normaliseColor`'s test in figma-import goes.
5. **A node's fields, one table for the inspector and the toolbar** (`apps/web/src/lib/node-fields.ts`).
   A `NodeField` says what a node holds as its view draws it (`read`, a missing value read as the
   field's `unset` where it has one), what setting a value writes (`write`, `null` taking a field
   off) and its undo step's name (`label`); `sharedField` reads the nodes as one value or `MIXED`.
   The table is `ALIGN` (a text's, `unset` start), `TEXT_STYLE` (read by name, written by
   `attachTextStyle`) and `TOKEN_FIELDS` (colour, fill, tint, radius, shadow, gap), each of which
   names the kind of token it offers. `node-actions`' `setField(field, value, targets)` sets one
   under its label, the selection's nodes when none are given. The inspector's text, appearance,
   layout and image sections draw them through `ColorField` and `NodeValueField`, which take the
   field and the nodes; the element toolbar's `TokenSelect`, `AlignSelect` and `TextStyleSelect`
   read and write them, and its controls name a field (`element-controls`' `TokenField` and each
   control's token kind go); the context menu's text style sets `TEXT_STYLE`. Their read/write
   pairs go, as do the toolbar's `as unknown as Record` casts and its `colorTokens`:
   `token-options`' `colorGroups` builds the colour options for both, and the toolbar's radius
   and shadow menus list `tokenOptions`. Where an edit lands is `breakpoint-edits`' as before, with
   one rule more: a field unset at a breakpoint is its `unset` value there (`unsetValueOf`), so
   start over a centred base is written `start` at `md`, and unset where nothing below differs.
   Fixed: unset and `"start"` are one align, written as unset; the inspector wrote `"start"` and
   read a text without one as nothing (a mix showed "Mixed" there and "Left" in the toolbar), and
   the toolbar's `null` at a breakpoint took the override away and showed the align below. Also:
   the inspector shows Start pressed for a text with no align; the undo labels are the toolbar's
   wording on both ("Align the text", "Change the colour", "Change the fill", "Change the tint",
   "Change the radius", "Change the shadow", "Change the gap", and the inspector's "Change the
   padding" and "Change the margin"); the toolbar compares the nodes' values rather than their
   labels (a gap of 16 beside `$spacing-4`, both "4", reads as mixed). Left where they are: props, which both set
   through `setPropsOfNodes` ("Change a prop") and read differently on purpose (the inspector
   shows a prop unset, the toolbar the variant it falls back on); padding and margin, already
   `sides`' on both; the fields only the inspector edits. `node-fields.test.ts` has table tests over
   node fixtures for each field's shared value, write and label, and `unsetValueOf`; the align
   tests failed first against the inspector's read and write (four of them). `node-actions.test.ts`
   sets start in the md view over a centred base and an unset one and in the base view, which
   failed first with `null` at `md`. No render-free test reads both surfaces' use of a field:
   both are components.
6. **The frame's host, the core's** (`packages/preview-core/src/frame-host.ts`). A frame's host
   and body element have two writers, the editor and the page's code, each with its classes and
   style properties apart (a style on an element of its own nobody sees); they are merged on the
   element, the page's properties over the editor's, and only what changed is written, so the
   host, which carries every `:host` rule, is not styled again for nothing. `showHost` writes how
   the editor shows a frame: framework-api's `FrameShown` (class, style, title, `interactive`,
   `away`), which `MountFrameOptions.shown` gives at first and `FrameRuntime.show` changes,
   partly, in place of `setInteractive`; the core sets the host's pointer events with `inert` on
   the body, and marks the host `data-ed-frame-host` with the frame's name. The guard of `<html>`
   and `<body>` (`document-elements`) writes the page's classes and, through `pageStyleOf`, its
   style properties as the page's (its `pageClasses` go); the body's defaults are the editor's
   there (`frame.ts`'s `shownOnBody` goes). `editor-frame`'s `present()`, its pointer-events,
   title and content-visibility writes and the park size it put on the host go: it keeps the
   whole `FrameShown`, gives it to a frame mounted anew, tells a reopened one its class and style
   again and a parked one its size, through `show`. Whether an event is from a frame is
   `Preview.fromFrame`, a mounted frame's host on its path (`turn`'s `frameOfEvent`, which the
   sandbox's listeners used already); the web's `from-frame` holds the preview loaded, and
   `keys.ts` and the canvas ask it in place of reading `data-ed-frame-host`, which stays for the
   e2e and bench scripts. Pictures (`specimens`) give their size in the open's style and are held
   in an `aria-hidden` holder rather than writing the host. Fixed: a page's `dark` class and
   `color-scheme` on `<html>` were wiped whenever the editor showed the host again (a parked
   frame opened, a node frame's class changed), `html.dark` rules then matching no more while the
   guard thought the class there. Also: the page's whole style written on its `<body>` (`style =
   …`, `setAttribute` or `removeAttribute("style")`) replaces only its own, the canvas's defaults
   staying (they were gone until the next render); a class the page takes off the body that the
   editor put there too (a `dark` theme) stays; an element marked `data-ed-frame-host` that the
   core did not draw is no frame to the editor's keys. Left: `data-ed-drawn`, which the bench
   reads, is still `editor-frame`'s; where a host is placed (its holder, the parking lot) is the
   editor's. The scripted renderer of `frame.test.ts` is preview-core's test adapter
   (`@ultrapaint/preview-core/testing`, outside the editor's bundle): the real `createPreview`
   in happy-dom, recorded stacks for whose code calls, a page script run as a frame draws, which
   then says it drew. `editor-frame.test.ts` tests the host on it: a page's `dark` and
   `color-scheme` kept on a parked frame opened again (failed first, the class gone), the host
   marked and shown as asked, the park size, and `isTyping` true for a key from a prototype's
   page and false for a stray marked element; the pool, drawing and events keep a fake preview,
   which now never touches the host. `frame.test.ts` has 4 tests of the host (shown as asked, the
   page's class and style kept when the editor shows it again, input off and on, an event from a
   frame), `document-elements.test.ts` 2 more (the editor changing its own, the body's whole
   style).
7. **The preview server's config, a module** (`packages/framework-react-vite/src/serve-config.ts`).
   `serveConfig({ options, vite, host, port, log })` builds the preview server's Vite config from
   the serve script's options and a loaded Vite: what it takes from the anchor's own (its plugins
   that belong to the application left out, the rest spared our bundles and Vite's cache), the
   plugins in their order (`ultrapaintResolve`, `serveAsset`, then `patchedClient`, `publicUrls`
   and `guardedCode`, each `post`, then React's and Tailwind's plugins when the anchor lacks
   them), the virtual ids and where it serves from; it gives the directories to watch beyond the
   root with it. `ServeOptions`, `realOptions` (the real paths the bundler compares) and
   `anchorModules` (whether the anchor resolves a package, and loading the repository's copy or
   ours) are its too. `serve.ts` keeps reading argv into the options, refusing an anchor without
   React, loading Vite, creating the server, watching, listening and stopping, as before:
   `node serve.mjs <options.json> <port> [host]`, the ready signal the server's probe of the URL.
   The warmed-up modules read `EDITOR_FILE` and `COMPONENTS_FILE` in place of `"editor.ts"` and
   `"components.ts"`. No behaviour changes. `serve-config.test.ts` creates one Vite server per
   file in middleware mode (no port, socket or watcher) over `fixtures/sandbox-host` as it is,
   with the generated directory and the bundles' in a temporary one, and has 8 tests: the anchor's
   config taken (its alias, `define`, proxy moved under the base) with the cache in the generated
   directory; the plugins' order and `enforce` among the anchor's and Vite's own; a component of
   the repository guarded (numbered loops, `async` marked, the module's start and end) and its
   public URL under the base; React as Vite bundled it given the loop checks only; the generated
   modules left alone; Vite's client patched; `virtual:ultrapaint/guard` resolved and loaded;
   the public files' module listing the fixture's `public/`. A dependency is read as Vite
   bundled it: one served from its own path outside the fixture's root is outside `fs.allow`.
   Left to `pnpm e2e:sandbox`: the image route (a middleware, which needs a request) and the
   anchor without React's plugin or with Tailwind's, which the fixture is not.
8. **The editor entry, declared** (`packages/preview-core/src/editor.ts`,
   `packages/framework-api/src/editor-exports.ts`). framework-api's `browser` declares what the
   generated entry exports (`EditorEntry`: `preview`, `onReloadRequest`, which the web's
   `preview-module` imports it as, its private `PreviewModule` gone) and what the editor bundle
   exports (`EditorBundle`: `startPreview`), with the dev server's events the start-up hears
   (`DevServerHot`, `vite:afterUpdate` and `vite:error`). Their names, which the framework writes
   the entry and builds the bundle with in Node, are `editor-exports`' lists, outside `browser`
   because the server compiles without the DOM; a type test holds each list to its interface's
   keys, so a name renamed, added or left out on either side fails `pnpm typecheck`. `build.ts`'s
   bundle entry (`bundleEntry`, now exported) and `previewFiles`' entry export the lists' names.
   `startPreview(load, hot)` is the start-up, its order written once in code and its doc: the page
   runtime (`installHooks`), then `load`, which imports the page's modules and gives the setup,
   then `createPreview`, which installs the guards, then the dev server's updates and errors told
   to every frame; it returns the entry's exports. The generated entry is the bundle's import and
   that call (`export const { onReloadRequest, preview } = await startPreview(() =>
   import("./preview-setup.ts"), import.meta.hot)`), and `preview-setup.ts` (`SETUP_FILE`) holds
   what it imported before: `host.css`, the registry, the public files and the providers, its
   default export the `PreviewSetup`. The order holds as before, by a stronger rule: the entry's
   only static import is the bundle, so nothing of the page's runs before the hooks, where it
   took `editor-hooks.ts` imported first (it goes); the page's modules still run before the
   guards. The comments of `preview-files.ts` and `kernel.ts` on the order go for the start-up's.
   The bundle no longer exports `createPreview` and `installHooks`; the preview server warms up
   the setup module too (Vite pre-transforms only static imports). Also: the page's modules are
   requested once the bundle has run rather than with it, one round trip later on the server's
   own machine. `preview-files.test.ts` (4 tests) reads `previewFiles()`' output and the bundle's
   entry with Vite's parser: the entry exports `EDITOR_ENTRY_EXPORTS`, imports only the bundle
   and only names of `EDITOR_BUNDLE_EXPORTS`, and imports one generated module dynamically, whose
   default export the setup is, with the stylesheet, the registry and the providers; the bundle's
   entry exports `EDITOR_BUNDLE_EXPORTS`. It failed first against the old template (the
   hooks' module and the page's modules imported statically), and a name renamed in the template
   fails it. `editor.test.ts` in happy-dom starts the real bundle: the hooks in place and the guards
   not yet when the page's modules run (failed with the hooks moved after `load`), the dev
   server's update and error reaching a frame's `hmr` and `error`, and the dev server's reload
   reaching `onReloadRequest`. `serve-config.test.ts` writes `previewFiles()`' output and a stub
   bundle and serves the entry: the bundle's import and the setup's dynamic import under the base,
   the hot context, and the setup's stylesheet, registry and public files. `pnpm e2e:sandbox`
   passes the same 15 checks as before the change (8 failed before it too).
9. **A token from another tool, named and placed once** (`packages/contracts/src/token-naming.ts`).
   `foreignToken(path, hint)` gives the kind and the design's name of a token another tool
   writes, from its path's segments and a hint of what the value is (`ValueHint`: the Design
   Tokens format's `color`, `shadow`, `fontFamily`, `fontWeight`, `duration`, `cubicBezier`,
   `dimension`, `number`, Figma's `string`, or null), or why it is left out; `numberCss(kind, n)`
   reads a number of a length kind (spacing, font size, tracking, radius, border width,
   breakpoint, container) in pixels. A hint that names a value type decides the kind; for a
   dimension, a number, a text or no type the path's words decide among the kinds that can hold
   it (the longest phrase found, then the earliest). Each kind's words are one record keyed by
   every kind the design system lists (`Record<Exclude<TokenKind, "other">, …>`, so a new kind
   fails to compile): its own (`corner`, `rounded`, `radii`; `space`; `stroke`; `font size`,
   `text`), which say the kind and leave the name, the ones that say it and stay (`gap`,
   `padding`, `margin`, `inset` for spacing), and the quiet ones a text kind drops
   (`typography`, `type`, `font`, `text`); the prefix is the token table's. A name drops only the
   found kind's words and the words that say where a token sits in the other tool (`primitives`,
   `semantic`, `tokens`, `theme`, `global`), and a word said twice; spacing with nothing left is
   the spacing base; a name that would read as another kind (a font family `Font/Weight/Bold`)
   is left out. Figma's reader gives it the variable's collection and name, Figma's unnamed
   collections taken out, with `COLOR`, `FLOAT` or `STRING`, and a style's name with `color` or
   `shadow`; its `NUMBER_KINDS`, `KIND_WORDS`, `LENGTH_KINDS`, `FONT_PATH_RE` and exported
   `tokenNameOf` go. The Design Tokens reader (`dtcg.ts`, in the server) gives it the path and
   `$type` (an alias's the type of the token it points at); its `GROUP_KINDS`, `TYPE_KINDS`,
   `GROUP_PREFIXES` and `nameFromPath` go, a token of the file's own extension keeps its name,
   and what it leaves out is one note per reason. Its notes reach the Design system panel:
   `readDesignSystem` gives `tokensNotes`, `DesignSystemState` has `notes`, and the panel lists
   them under the problem line, muted (there was no place for them; this is the smallest). The
   scan (`design-system-scan`) places a theme variable by `tokenKindOf` and lays every kind but
   the colours (its palettes) and font sizes (with their line heights) into the design system
   with `addTokens`, each kind in its order; `NAMESPACES` and `moreFoundations` go. The token
   table names `default-transition-duration` a duration (`TokenKindEntry.names`, whole names
   beside the prefixes). Name and kind changes: a Design Tokens `Corner.sm` dimension is
   `radius-sm` (it was `corner-sm`, of no kind, dropped without a word); `text.primary` of
   `$type: color` is `color-text-primary` (a text size); `font.size.sm` is `text-sm` (a font
   family); a token of a kind no word or type says (`size.small`, an opacity) is left out with a
   note (it was named after its path and dropped); a camel-cased or underscored key is split
   (`primaryForeground` is `primary-foreground`); a number of a length kind is in pixels;
   `global`, `semantic` and the other place words leave the name. Figma's `Color/Text/Primary`
   is `color-text-primary` beside `Color/Primary`'s `color-primary` (they collided), as
   `Color/Border/Default` keeps `border`; `Text/Line height/Body` stays `leading-body`; a
   tracking number is in pixels (it was bare); `Font size/Base` is `text-base` (`base` was
   dropped, leaving nothing); `Spacing` alone is the spacing base; a camel-cased segment is
   split. Figma tokens already matched are kept by their Figma id, so only new names change. The
   scan lists the repository's own `--inset-shadow-*`, `--drop-shadow-*` and `--text-shadow-*`
   under shadows (Tailwind's defaults of them stay out, as its palette does when the repository
   has colours), so `/init` no longer leaves them undescribed; `starterElevation` takes only
   `shadow-*`. `token-naming.test.ts` is the table: 35 paths and hints to a kind and name, 6 left
   out, a name for every kind's own word, and the pixels rule. Each reader's test checks its
   syntax: `dtcg.test.ts` reads a `$type` over the group's word, an alias's type, a `Corner`
   dimension and a number of a radius (failed first: `text.primary` a text size, `corner-sm`);
   `design-system-files.test.ts` lists a `Corner.sm` added by another tool under radius and gives
   the note of what it left out (failed first); Figma's `tokens.test.ts` reads an unnamed
   collection's `Color/Primary`, `Color/Text/Primary` and `Rounded/lg` as three tokens and notes a
   boolean (failed first, one `color-primary`); the scan's test lists the repository's own drop,
   inset and text shadows, not Tailwind's, a `default-transition-duration`, and every token the
   repository declares listed (failed first). The tests of `tokenNameOf` go.
10. **A frame's error, kept by the frame** (`apps/web/src/canvas/editor-frame.ts`,
    `packages/framework-api/src/browser.ts`). framework-api declares `PageError` once: its
    message, file, line and stack, and its `source`, `"page"` (the page's code threw and nothing
    caught it) or `"dev-server"` (a module could not be brought up to date). `FrameEvents.error`,
    `Preview.onStrayError`, `RenderSetup.reportError` and `Preview.reportError` take it or a part
    of it, and the core says whose: the renderer's report and what the sandbox finds thrown are the
    page's, `Preview.reportError` the dev server's. contracts' `HostError`, preview-core's
    `FrameError` and the four inline copies go. `EditorFrame` keeps its mount's latest error
    whoever listens (`error`, `onErrorChange`, and `useFrameError(id)` for React): the page's until
    the frame draws again, a render asked after the error (React reports a render's error before
    the render says it reached the screen, so that render does not clear it), or an update
    (`hmr`); the dev server's until an update; on screen, off it or parked; gone when the frame
    is dropped, and what a page thrown away since says is not taken. `describePageError` writes one
    (the message, then the file and line) for the canvas's banner (`Highlights`), the prototype's
    and the stray-error toast; `formatHostError` and the toast's own formatting go. The store's
    `hostErrors` and `setHostError` go, as do the listeners that set and cleared it (both
    views' `error` and `hmr`, the canvas's clearing on `ready`, the prototype's on `rendered`). `eventsOf` and `forwardTo` answer
    `Required<FrameEvents>` and `Required<FrameListeners>`, so a kind left out fails to compile.
    The dev handle has `frameErrors()`, which `pnpm e2e:sandbox` reads in place of `hostErrors`.
    Fixed: a canvas frame panned away and back lost its banner while its module was still broken
    (cleared on `ready`), and one off the screen or parked never showed it; the prototype cleared
    a page's render error as soon as it was reported. Also: the canvas clears a page's error when
    the frame draws again (it kept it until an update or until it came back on screen); the
    prototype keeps a dev-server error while its page draws, until an update; a frame's error
    goes when its frame is dropped (the prototype reloaded, a parked frame trimmed). Left: a frame
    mounted after a dev-server error is not told it. `editor-frame.test.ts` has 6 tests on the
    fake preview: an error reported with nobody listening is there when a listener comes and after
    one leaves and comes back; a page's error stays through the render it was told during and goes
    with the next; the dev server's stays through a draw and goes with an update, as a page's
    does; a parked frame holds it, dropping clears it and the dropped page's error is not taken;
    `describePageError`; `forwardTo` hands on every kind, a record without one failing to compile
    (`@ts-expect-error`). The first four failed first. preview-core's `frame.test.ts` reads the
    source of a renderer's report and of `reportError`, and `editor.test.ts` and
    `sandbox.test.ts` the dev server's and the page's (failed first). `pnpm e2e:sandbox` passes
    the same 15 checks as before (the error checks reading `frameErrors()`).
11. **What a frame draws, said once** (`apps/web/src/canvas/page-request.ts`,
    `apps/web/src/canvas/editor-frame.ts`). `useFrameDrawing(id, request)` draws a frame's request
    (`RenderRequest`, the look now given by every view) as soon as the frame is open, whenever the
    request changes and whenever the frame is opened anew, while neither is null; `render` already
    compared the request's parts with what the frame shows, so a request built afresh with the
    same parts draws nothing. `pageRequest` builds a page's for the canvas and the prototype from
    the tree, why its file cannot be read (`problem`) or what is said for no page (`absent`), the
    design system, the canvas's defaults, the look, the mode, the width and the box a node on the
    canvas is held at: the tree at the width's breakpoint (`resolveAt`, which gives the same tree
    within one), a node with no width at its held width or its own, and the held box's size laid
    over it, the same object while the size is. The canvas's `Frame` and the prototype call them;
    `renderFrame`, `renderRoute`, their `ready` listeners and both `biome-ignore`d redraw lists
    go, as does `drawResized`: a node resized on the canvas is drawn at the box the canvas holds
    (`held`), which the store already had for its frame, until the document has it. The type
    specimen and the components' matrix memoise their request (`useMemo` over what they draw),
    the matrix's look with the spec being edited in place of the saved one; their `ready` state
    goes and `PreviewSurface`'s `listeners` are optional. `useDesignLook` (the look, a new one only
    when the specs or the styles change) replaces `useDesignLookVersion`. Fixed: a specimen whose
    frame was thrown away and opened again (the preview stopped and started) stayed blank, as
    its `ready` state never went back; the matrix did not draw again when another component's
    spec changed (a card inside the button kept its old look). Also: the type samples are drawn
    with the look they are given and again when it changes (they took the look of the moment
    the design system or the search changed). Left: the canvas's rect watching keeps its
    `biome-ignore`d list (the document there only sends the watched nodes again, nothing is
    drawn). There is no React render test setup in `apps/web`: `specimens-drawing.test.tsx`
    renders the real `TypeSpecimen` and `Matrix` (now exported) with `react-dom/client` and
    `act` in happy-dom, no dependency added, over a fake preview and `usePreview` mocked: each
    draws again in a frame opened after the preview stops and starts (both failed first, nothing
    drawn); the matrix draws again when another spec changes (failed first) and not when drawn
    again with the same spec, and draws the edited spec in place of the saved one.
    `page-request.test.ts` has 12 table tests: the defaults, design system and look; nothing,
    a read problem or no page said; four widths to their breakpoint's values; the same tree
    within a breakpoint; a node at its own width; a node held at a size, at that size's
    breakpoint, the same tree held again; a node held only where it was let go as its document
    has it.
12. **Frame gestures, one module** (`apps/web/src/canvas/frame-gesture.ts`). A press on a frame's
    name or corner begins its gesture (`beginFrameGesture`, the frames' `onDragStart`): a page's
    frame (or a view's) moved or sized, a node on the canvas sized, a node on the canvas moved by
    its name a drag as before (`followLooseDrag`, which moved here), a locked one only selected.
    Each follows the pointer on the window through one helper, which puts back a gesture whose
    pointerup never came before the next begins. A page's frame is drawn as it goes with
    `showFrame` (the store's frames, nothing sent) and set once when let go, rounded
    (`setFrame`, one `canvas.set`); a node is held at its size as it goes (`hold`) and kept there
    until its one "Resize" edit lands (`holdUntil`). A cancelled pointer puts the gesture back:
    the frame shown where it was, the node held as it was before (its document's size when it was
    not, which its frame draws again). `cancelGesture()` puts back whatever the pointer is doing,
    this gesture, a drag (`useDrag`) or a group or text being drawn (`useCreate`), and says
    whether there was one: the canvas's Escape stops there when there was. `resizeFrom` and
    `placeFrame` moved here with it. The `useRef` union leaves `Canvas`, which keeps only where a
    pan began; `setFrame`'s `persist` flag goes (it always saves), and the node's resize no
    longer writes its measured size (`setSize`): the outlines clip at the box it is held at.
    Fixed: a cancelled pointer saved a page's frame where the pointer had taken it, and a node's
    resize as a "Resize" edit; Escape did nothing to a frame being moved or sized (and went on to
    the other Escape handlers). Also: a node dragged inside a page is put back on a cancelled pointer
    (`useFramePointer`'s `onPointerCancel`; it was dropped where the pointer was, onto the canvas
    when over nothing), and a marquee cancelled selects nothing; Escape on a node dragged on the
    canvas stops following the window too; a click on a frame's name without moving it no longer
    saves the layout. Left: touch and pen (no `touch-action`), Escape on a marquee, the layout's
    save timer (step 13). `canvas.test.ts` goes: `frame-gesture.test.ts` has its helpers' tests
    and 7 more through `useEditor` and `fakeApi`, the window's listeners stubbed: a move sends one
    `canvas.set`, rounded, on release; a cancelled pointer and Escape put the frame back and send
    nothing; Escape puts back a drag and a group being drawn; a node's resize holds it and sends
    one "Resize" edit; a cancelled one sends none and holds nothing; a click on a frame's name
    sends nothing. They failed first with the module missing; the old gestures lived in `Canvas`,
    which no test rendered. `use-frame-pointer.test.tsx` renders the hook in happy-dom over a
    stand-in preview: a node dragged off its page and cancelled is put back and sends no edit
    (failed first: the hook had no cancel), and let go there it lands.
13. **The layout saved as it changes** (`apps/web/src/state/editor.ts`). No timer: `setFrame`
    saves at once, one `canvas.set` and one undo step, sending its page's frame (a view's
    change its page's, with its views) and the pages drawn where no frame of theirs is saved yet,
    which would otherwise move with it once the layout comes back, rather than every frame of
    the canvas. The server already merged a partial `frames` map page by page, replacing a page's
    whole entry, so a view removed is said by its page's frame without it; neither the RPC nor
    the server changed. The saves the server has not answered are kept, each with its canvas and
    what it sent: a layout pushed (`applyLayout`) or read when a canvas opens (`openedCanvas`)
    applies to every page but those, which stay as last sent (`withSaving`), and the push after
    the answer brings them current. `layoutSaved()` waits for the saves in flight; it replaces
    `flushLayout`, for undo and redo and for opening a snapshot (whose layout must not be drawn
    with a live save over it), and opening another canvas no longer flushes (nothing waits).
    `persistTimer`, `persistLayout` and `saveLayout` go. Fixed: a page an agent's `set_frame` or
    another editor moved within about 400 ms and a round trip of the user moving another page
    went back to the editor's old copy, on screen and on disk (the whole canvas was sent, and
    the push dropped while the timer waited); a second gesture begun within 400 ms of the first's
    release saved its unrounded in-between place as an undo step. Also: two quick changes
    (two views added, two presets) are two undo steps where they were one; a page's frame is on
    disk as soon as it is let go. Left: a push that arrives during a gesture, with no save in
    flight, still draws the frame at the pushed place until the pointer next moves, as before.
    `editor.test.ts` has 6 tests in place of the one that kept the frames while a change waited,
    through `followServer` and `fakeApi.emit("canvas", …)` with the saves' answers held: a frame
    is sent at once, only its page, as it was set (a gesture showing it elsewhere since sends
    nothing more); the pages drawn where nothing saves them are sent with it; a push moving page
    B while A's save is in flight moves B and keeps A; a push with A's old place while its save
    is in flight keeps A, and one after the answer moves it; A stays through a push while its
    second save is in flight, its first answered; an undo waits for the save. The first five
    failed first (nothing sent before the timer, the push dropped); the undo one passed, as
    `flushLayout` already waited for the save it started. `location.test.ts`'s save on leaving a
    canvas reads as one save sent at once.
14. **Bringing something into view** (`apps/web/src/lib/reveal.ts`). `reveal(target)` takes a
    page's frame (`{ page }`) or a node of a frame (a `Selection`): it leaves the prototype,
    opens the canvas the page is on when it is another (`goTo`, at the page), selects it there
    (`selectPage` or `select`), and has the camera glide to it once its frame is laid out
    (`zoomToSelectionOnceLaidOut`). Laid out is known from the stores, not waited for by a
    frame: the canvas on screen and the frame's box known (`allFrames`), a node beside the pages
    once its document is read; the frame need not be drawn, as one off screen is drawn once the
    camera is there. A move of the camera meanwhile gives the wait up (`land`), another reveal's
    included, as does the canvas changing or the prototype opening; a reveal whose canvas was
    overtaken by another goes no further. What of the canvas is seen is the camera's to read:
    the canvas on screen measures it for the camera (`measureViewportWith`, from `useCamera`'s
    layout effect, the panels beside it placed), so `zoomToFit()` and `zoomToSelection()` take
    no viewport, `viewportSize` moved from `shortcuts` to `state/camera.ts`, and a test measures
    with a stub. The page's Zoom to page (`zoomToPage`), a link pressed on the canvas
    (`focusLink`), a node link opening the editor (`useOpenNodeLink`), a thread's Show
    (`showScope`), following an agent (`useFollowAgent`), a node's Zoom to selection and a
    comment's Select element from the prototype call it, each keeping its own: the link's toast,
    the node link's lookup, a comment's Select element on the canvas only selecting. Both
    `requestAnimationFrame` waits, the prototype branches of `showScope` and `useFollowAgent`,
    and every caller's `viewportSize()` go. Fixed: a thread's Show on a page of another canvas
    (the threads panel lists every canvas's) selected a page this canvas does not draw and did
    not move; it opens that canvas, selects the page or node and glides to it. Also: following
    an agent onto another canvas selects its page and glides there (it only opened the canvas);
    a node link and a reveal from the prototype leave it for the canvas; a node beside the pages
    whose document is not read yet is zoomed to once it is, and a reveal from the prototype once
    the canvas is laid out rather than a frame later; `pnpm bench:canvas` fits into what the side
    cards leave seen, as Shift+1 does, rather than the whole canvas. Left: a thread scoped to a
    node beside the pages of another canvas (its scope names the canvas's file, not the canvas)
    is shown only from its canvas; a comment's reveal (`revealComment`) pans to its pin without
    selecting, as before. `reveal.test.ts` has 7 tests through the stores and `fakeApi`, the
    viewport stubbed: a page of the open canvas; a node of a page on another canvas (canvas
    switched, page shown, selection and camera); from the prototype, which it leaves, the camera
    moving only once the canvas is on screen; a node beside the pages waiting for its document;
    a wait given up for a newer reveal; and a thread's Show of a page and of a node on another
    canvas. The two Show tests failed first on the old `showScope` (the canvas stayed `main`).
15. **A design target, named once** (`apps/server/src/services/design-targets.ts`,
    `services/page-names.ts`). `designTargetNamed(pages, specs, name, canvas?)`, beside
    `pageNamed`, says which design a name means: `spec:Button`, or a name no page could have (no
    `/`, `#` or `.page.json`, so `Button`), names the component's spec; anything else is a page by
    `pageNamed`'s rule, a canvas written first (`marketing:/pricing`, `marketing:pricing.page.json`)
    included, and a node reference (`/orders#c_8`) names its page and keeps its node. It answers
    the page (with its node), the spec, a miss of one kind (`Missing{kind}`, with the URL a page's
    name was read as), or the canvases a page's name is ambiguous across (`/` in two canvases);
    the canvas given narrows the pages, over one the name says. Pages are named by URL or file
    and specs by component, so the two never answer to one name and "spec wins" decided nothing.
    The `DesignTargets` service, above the specs, the comments and the link to the code (in the
    project's layer, beside `PagePngs`), `resolve`s a name to a `DesignTarget`, a miss saying the
    kind it looked for and listing that kind (the pages with their URL and file, the component
    specs), reads a design's open behaviour notes (`notes`) and adds one (`addNote`), on a page's
    node (the reference's or `node`, the two refused when they differ) or a spec's slot, whichever
    way they are kept: a page's as comments pinned on it (resolved when done), a component's in
    its spec (deleted when done). One reader each, in `implementation.ts`: `pageNotes` (with
    `commentNote`) and `specNotes` (with `specNote`), which the design's hash and its diff read
    too; `noteOf`, `specNoteOf`, `ImplementationService.notes` and page-tasks' own mapping go.
    `/implement` and `handoff`'s `read`, `mark` and `note` resolve through it; page-tasks'
    `specNamed` and `unknownPage` go (`pageEntry` moved), as do handoff's `isSpecTarget` branch,
    its use of `pageAt` and its comment and spec writing. `ImplementationService.current` takes
    the canonical target only, a page's id or `spec:<Component>` (it also took a page's file,
    which no caller passed); `targetId` gives it. Fixed: `handoff`'s `note` on `/orders#c_8` with
    no `node` pinned the note to the whole page ("Noted on designs/orders.page.json."); `read`,
    `mark` and `note` with a bare `Button` (what the Components panel sends `/implement`) failed
    with "no page file Button; call list_pages"; `/implement spec:Nope` said "no page is
    spec:Nope" and listed the pages. Also: `/implement` takes a node reference and a canvas
    written first, and `handoff` a canvas written first without a node; a node reference and a
    different `node` are refused ("the target names the node c_8, and node says c_9: say one");
    `handoff`'s misses list the pages or the specs in place of pointing to `list_pages`, and a
    page in several canvases lists the pages (it said to pass `canvas`); a bare name that is no
    spec says how a page is named ("no component spec is orders (a page is named by its URL or
    its file)"), where `/implement orders` listed the pages; a node beside the pages
    (`canvas#c_1`) is no page; a note on a spec's `root` answers "Noted on Button." (it said
    "(root)"). Left: the other tools' `pageAt` keeps its own messages and does not take
    `marketing:/pricing` without a node. No tool's description or schema changed (the listing's
    budget is as it was). `page-names.test.ts` has 3 table tests of `designTargetNamed` (21 names,
    the canvas given, ambiguity), which failed first with the function missing.
    `design-targets.test.ts` has 4 tests on `ProjectTest` through `callTool` and `AgentTasks`: a
    note on `/home#heading` lands on the node; a node reference and another `node` are refused
    and `read` takes a node reference; `read`, `note` and `mark` with `Button` succeed, and
    `/implement` by either name carries the note from the spec; misses of each kind, `/implement
    spec:Nope` naming the specs. All four failed first. `tasks.test.ts`'s `spec:Nope` reads the
    new miss; the socket tests of `handoff` (`design-source*.test.ts`) pass unchanged.
16. **Agent switches and batch reverts wait for the turn** (`apps/server/src/services/threads/thread-session.ts`,
    `services/setup-steps.ts`). `ThreadSession.switchAgent(patch, note)` decides a switch under
    the session's `prompting` permit, taken only if it is free: while a prompt is being accepted
    (its task and attachments written, the thread not yet running) or a turn runs, it answers
    `Conflict` ("the agent is still working on the previous prompt", what the web already shows
    for a busy thread); otherwise it stops the live session, makes the thread idle with its new
    agent and writes the "Switched to" note (replacing one left by a switch before), so a prompt
    can no longer be half accepted while its agent changes. `ThreadService.setAgent` names the
    agent, reads its options and delegates; its own busy check, read off the store outside the
    permit, goes. `ThreadSession.stop` (and `ThreadService.stop`) asks the agent to stop its turn
    and waits for the thread to leave busy, re-read whenever the store publishes, ten seconds at
    most (`TURN_END_WAIT`). `SetupSteps.revertBatch` stops Migrate's turn first when the batch is
    the one under way, waits, then has the setup put its files back; a done batch leaves the turn
    alone; the RPC goes through it rather than the setup. Redo shares the wait: the threads of the
    steps it moves are stopped together and waited for before the files go back; stop still only
    asks (what the step did is kept). `McpAccess.endpoint` gives the MCP server's URL, once the
    server listens, and the token's header; `MCP_PATH` and `MCP_TOKEN_HEADER` move from the route
    to `access.ts`, and the thread's session and `mcp.connection` no longer build the URL
    themselves. `checkMapping` moves into `FigmaImportService.map`, which answers the mapping as
    kept (its `from` resolved), the import after it and the notes on props the component does
    not declare; `map_figma_component` only decodes and calls it. Fixed: picking another agent
    while a prompt was being accepted switched it, and the prompt went to the new agent; with the
    switch's reads in between it could close the session under the turn just opened (no
    `turn_end`) or leave the thread idle while a turn ran (read, not reproduced); Revert on the
    batch Migrate was working on put the files back while the agent still wrote. Also: the
    Revert confirmation of the batch under way says the agent's turn is stopped first; a redo,
    or a revert of the batch under way, takes up to ten seconds longer when the agent is slow to
    stop, and goes ahead after them. No tool's description or schema changed. Failing first:
    `thread-session.test.ts`'s `setAgent` while a `/hold` prompt is accepted (`HeldTask` in
    `testing/threads.ts` holds its task until the test lets it go) answers `Conflict`, and the
    prompt's turn runs on the same agent and ends; `setup-steps.test.ts` has 3 tests: the batch
    under way goes back only once its turn was asked to stop and has ended (the thread idle when
    the files go back), after ten seconds at most of a turn that does not end (still
    "cancelling"), and a done batch is reverted with the turn left running. All four failed
    first. `mcp-access.test.ts` gives the access its port; the socket test of the Figma tools
    passes unchanged.
17. **A signal does not wait for an answer** (`apps/desktop/src/open-project.ts`). `OpenProject`
    asks its stop questions through one `confirm`, raced against a signal: `stop({ ask: false })`
    (SIGINT, SIGTERM) marks the app signalled, which answers no to the question on screen, a
    quit's, a switch's or a restart's, so the side asking lets go of the switching permit; the
    signal's stop then takes it and stops the server at once, and a question asked after it is
    answered no without being shown. `stop({ ask: true })` while a quit's question is on screen
    asks nothing more and has that question's answer (`quitAsked`), which `main.ts`'s `asking`
    flag did: the flag goes, `quit` keeps `quitting` (set by the first quit that stopped the
    server, so a second one answered the same does not quit again), and its comment that a
    signal is not held up by a question on screen is now true. The stuck pages' beat is
    `BEAT_MS` beside `BEAT_CHANNEL` in `bridge.ts`, which the preload sends on and
    `stuck-pages.ts`' doc and test name in place of 250 ms. Fixed: a SIGINT or SIGTERM (a
    logout, `kill`) with a quit's or a switch's question on screen waited for someone to answer
    it, or for SIGKILL, and the servers' scopes never closed. Also: the question cut short by a
    signal closes, as if cancelled: the shell's `confirm` gives Electron's message box the abort
    signal of its interruption (on macOS not a box with no parent window, which runs
    synchronously; the app's window is its parent whenever there is one). Otherwise as before: a double close, Cmd-Q while asking and
    a quit refused. `fakeShell`'s answers take an effect, an answer
    given later (`Effect.never`, one never given). `open-project.test.ts` has 3 tests more, the
    signal's stop given a second of `TestClock` at most: with a quit's question that is never
    answered on screen and a second close forked, the signal's stop stops the server, both
    asking stops answer false and one question was asked; a switch's question cut short by a
    signal, the switch not made, the server stopped and a switch asked afterwards shown nothing;
    a second close while the quit's question waits for the user's no asks nothing and has the
    no. The first two failed first (the signal's stop still waiting after the second); the third
    fails with the join taken out (a second question, answered yes, stops the server). The
    refused-quit test reads the signal's stop the same way.
18. **The checkpoints and snapshots, followed** (`apps/server/src/services/design-refs.ts`,
    `apps/web/src/state/kept.ts`). `makeDesignRefs` is given how a ref is listed (`listed`, its
    `at` the order) and how its list is told (`publish`): `keep`, `name` and `release`, the only
    places either history is written, tell the editor the open repository's list, newest first,
    once each, and `list` is that list, which `Checkpoints.list` and `Snapshots.list` are. The
    last-30 rule is the namespace's `keepLast`, applied in `keep` before the list is told, so a
    turn past 30 publishes once; `Checkpoints`' own `collect` and `every` outside `design-refs`
    go. contracts has two events, `checkpoints` and `snapshots` (each the whole list of its kind,
    as `checkpoints.list` and `snapshots.list` answer; `history` already names the log and undo
    state). The web's `kept` store follows both like any server data (read when the Changes
    panel opens on a repository, again at every connection open, live while a snapshot is on
    screen, since a snapshot keeps no history); the panel reads it, and its tickets
    (`asked.current`), `refresh`'s history half and the `onChange`, `onKeep` and `onRevert`
    callbacks threaded through `Snapshots`, `SnapshotRow`, `Checkpoints` and `CheckpointRow` go;
    `snapshot-actions` reads nothing again and `deleteSnapshot` answers nothing. `server-data`
    takes answers in the order their reads began: one older than an answer taken is dropped, and
    a piece's `whole` events (those bringing the whole of it, as a read does) make a read begun
    before them older too. Git's status stays read on `file.changed` (after 250 ms of quiet) and
    taken from `git`, a piece the panel follows while shown (`whole: ["git"]`), so its tickets go
    the same way. Fixed: a turn that writes no design file left its checkpoint off the list until
    some file changed; a snapshot saved or deleted in another tab was missed; a checkpoint let go
    of by the last-30 rule stayed listed and failed with NotFound when clicked; an older read of
    the history could land after newer news. Also: the history is read again when another
    repository opens (it waited for a file to change); a `git` event unticks the files no longer
    changed, as a read did; after a commit the panel takes the status the commit publishes
    rather than reading it again; the Refresh button still reads both. `checkpoints.test.ts` has
    2 tests more on `ProjectTest` (an agent of the state directory's, the MCP server off): a
    prompt whose turn writes nothing publishes the list with its checkpoint, the same as
    `Checkpoints.list`; a snapshot made and deleted publishes twice, with it and without. Both
    failed first (nothing published within two seconds). `server-data.test.ts` reads the
    checkpoints and snapshots with every store at an open, follows their events (nothing read)
    and keeps the snapshots live under a snapshot on screen, and has 2 tests that failed first:
    an answer older than the server's news is dropped, and one older than an answer taken.
    `snapshot-actions.test.ts`: a snapshot saved and deleted shows in the history by the server's
    news alone, no list read.

## Follow-ups built

1. **The built-in skills name tools through `agent-ways`** (`apps/server/src/skills/`). Layout,
   components and colour are functions of `AgentWays.tools`, and `builtInSkills(tools)` gives the
   list; `SkillsService` words them for the server it runs in, so the briefing, the Skills panel
   and a copy made to replace one say what the server offers. With the MCP server their text is
   as it was, word for word and line for line (the design evals may be tuned to it); without it
   no tool is named: layout checks the page at `390` and `1440` without `get_screenshot`'s
   `width` and leaves out giving the page views with `set_frame`, components reads a
   component's code for its props and variants and gives every prop real content (in place of
   starting from `get_component`'s example), and colour computes from `design.tokens.json` (in
   place of `read_design_system`). A project's own skill files are left as the project wrote
   them. `tasks.test.ts`' two tests over every task request and the briefings, MCP on and off,
   now brief with the built-in skills (they were turned off) and read a line of each of the three
   both ways; without the server it failed first, the briefings naming `get_screenshot`,
   `set_frame`, `read_design_system` and `get_component`.
2. **Tool answers name tools through `agent-ways`** (`apps/server/src/services/threads/agent-ways.ts`).
   The record of the tools' names is exported as `TOOLS`, for what only an agent with the tools
   reads: what a tool answers and what the MCP server tells its clients (a text an agent may read
   without the server still takes `AgentWays.tools`). The MCP route's instructions (`handoff`,
   with `handoffCall` for its "list", `apply_operations`, `write_design_system`), Figma's misses
   (`list_figma_imports`, `list_components`), DESIGN.md's front matter given other values
   (`write_design_system`), Migrate's finish with no batch under way (`next_batch`),
   `get_component`'s miss (`list_components`), `set_home` on a page with no URL
   (`set_page_url`), the screenshot's misses (`read_canvas`, `read_page`) and `ask_user` without
   a form or a thread name them from it, so renaming a tool fails to compile there too. Every
   text is as it was. Left: the tools' descriptions (`Tool.make`'s, and the page tools' guide)
   still name other tools by string, since the record is typed from the toolkits those
   descriptions are part of (reading it there is a cycle the compiler refuses); and
   `lookup.ts`' `list_pages`, which follow-up 5 replaces. `tasks.test.ts`' test with the MCP
   server reads the instructions too: every tool they name is offered.
3. **The snapshot store collects once every ten refs let go of** (`apps/server/src/services/snapshot-store.ts`).
   Collecting reads every ref and every kept manifest and lists every object, so past 30
   checkpoints each turn paid for the whole store (every snapshot kept and the setup's
   snapshots of the project included) to free the few files that turn changed. `release` now
   collects itself, at the first release of a run (so what an earlier run left goes then) and
   then once every `COLLECT_EVERY` (10) refs let go of; `collect` leaves the store's interface,
   and `design-refs`' `letGo` and the setup's call of it go. A turn past 30 pays a tenth of a
   collection, and what is left over meanwhile is at most the content only the last nine refs
   let go of kept. Chosen over collecting only when a release can free something, which needs
   the same scan to know, and over collecting when idle, which leaves the same work in the
   background and a timer to test. Behaviour: a checkpoint let go of, or a snapshot deleted,
   keeps its files in the store until the collection that follows; it leaves the list at once.
   `snapshot-store.test.ts` has 1 test more: the first release of a run collects, the next nine
   leave the released manifests in place, the tenth removes them all and the content they
   alone named, and the content a snapshot of another namespace shares stays; it failed first
   (nothing was collected), and the two tests that called `collect` let go of refs instead.
   `checkpoints.test.ts` has 1 test more: after 40 turns more, a file only a released checkpoint
   had is gone from the store, and one a snapshot shares with a released checkpoint is still
   read and diffed.
4. **`ProjectTest` says it listens** (`apps/server/src/testing/project.ts`). The test's server
   says it listens on `TEST_PORT` (1, where nothing listens and no scripted agent connects) once
   it is built, as `server.ts` does once its socket is open, so `McpAccess.endpoint` answers and
   a prompt reaches the scripted agent with the MCP server on. Nothing changes outside the
   tests. `checkpoints.test.ts`' two tests of step 18 run with the MCP server on, as every other
   test of the file does; the turn's failed first (the prompt waited for
   the port, and the test timed out). `tasks.test.ts`' tests without the server stay so: they
   test that.
5. **The other tools name a page by the design target's rule** (`apps/server/src/services/page-names.ts`,
   `services/mcp/lookup.ts`). `pageTargetNamed(pages, name, canvas?)` is the page half of
   `designTargetNamed`, which now calls it: `pageNamed`'s rule, a canvas written first
   (`marketing:/pricing`) included, a node reference naming its page and keeping its node, a
   node beside the pages (`canvas#c_1`) answered as `Loose`; a bare name stays a page's (an id or
   a file), since these tools name no spec. `pageMissed` words a miss for both, from what
   `DesignTargets.resolve` wrote: "no page is X" (in the canvas given), or the canvases a name is
   a page in, then every page with its URL and file; `pageEntry` moves beside it (page-tasks
   reads it there). The tools' `pageAt` asks them, and keeps only its own answer to a node
   beside the pages (pass `loose: true`). Fixed: every tool that takes a page (`read_page`,
   `apply_operations`, `focus`, `get_screenshot`, the page and canvas tools) refused
   `marketing:/pricing` without a node ("no page file marketing:/pricing; call list_pages to see
   the pages"). Also: their misses list the pages in place of pointing to `list_pages` ("no page
   serves /x" is "no page is /x; the pages are: …"), and a page in several canvases lists them
   rather than saying to pass `canvas`. No tool's description or schema changed.
   `design-targets.test.ts` has 1 test more on `ProjectTest`: in a second canvas made by the
   tools, `read_page` reads `<canvas>:/pricing`, and misses by URL, by URL in a canvas given and
   by file say so and list the pages; it failed first. `page-names.test.ts` has a table test of
   `pageTargetNamed` (8 names).
6. **A length's keyword, only where Tailwind takes it** (`packages/style-tailwind-v4/src/utilities.ts`).
   `lengthKeywords(utility)` gives the keywords each length utility takes, as Tailwind v4.3
   compiles them (checked by compiling each pair): a width, a height and their minimums a size by
   name (`auto`, `fit`, `full`, `max`, `min`) and the viewport's lengths in either unit (`dvh`,
   `dvw`, `lvh`, `lvw`, `svh`, `svw`), `screen` in their own axis's and a height the line's
   (`lh`); a maximum no `auto` but `none`; `size` no `screen`; a margin `auto` only; a gap or a
   padding none. `SIZE_KEYWORDS` and `SCREEN_KEYWORDS` go. The writer (`node-classes`' `spacing`)
   and the spec reader (`component-spec`'s `sizeOf`, by `w`, `h` or `size`) ask it. Fixed: a gap,
   a padding or a margin of `100%`, `fit-content`, `min-content` or `max-content` (and a gap or a
   padding of `auto`) was written as a keyword class Tailwind does not have (`gap-full`,
   `p-auto`, `m-fit`), so it set nothing; it is the value in brackets (`gap-[100%]`), and a
   maximum of `auto` is `max-w-[auto]`. Also: `100dvh` as a width is `w-dvh`, `none` as a maximum
   `max-w-none`, `1lh` as a height `h-lh`, and the spec reader reads them back. `node-classes.test.ts`
   has 2 tests more: a gap of `100%` is `gap-[100%]`, and 11 length properties at 10 values
   each are written as one class Tailwind compiles to that declaration; both failed first (25
   classes compiled to nothing). `utilities.test.ts`' keyword test compiles 24 utilities with 14
   keywords and checks the vocabulary says what Tailwind does. The tests compile through
   `testing.ts` (Tailwind's theme, what each class sets), which `canvas-and-code.test.ts` now
   uses too; its check that Tailwind compiles every class the writer gives the fixtures stays.
7. **The usage rewrite reads the design system once a run** (`packages/framework-api/src/node.ts`,
   `packages/style-tailwind-v4/src/usage-rewrite.ts`). `UsageReader.rewrite(file, text, ctx,
   mapping)` is `rewriter(ctx, mapping)`, which reads the design system's tokens (`knownOf`, the
   colours' lookup by value with them) once and gives the rewrite of one file; Migrate's pass
   over the sources and a batch's rewrite (`design-system-setup.ts`,
   `design-system-setup-batches.ts`) make one per run, so a colour asked for in one file is
   answered from what the lookup found in another. What a file is rewritten to is as it was.
   `usage-rewrite.test.ts`' tests make a rewriter, one of them rewriting a component and a
   stylesheet with the same one; they failed first (no `rewriter`).
8. **The page's `toggleAttribute` as the DOM's, and the host marked drawn by the core**
   (`packages/preview-core/src/document-elements.ts`, `frame.ts`). The page's
   `toggleAttribute(name, force)` on `<html>` or `<body>` behaves as the DOM's: toggled on, an
   attribute keeps its value (or is there, empty), toggled off it goes, and it answers whether
   it is there. For `class` and `style` that is the page's own classes and style: on leaves them,
   off clears them, the editor's left. Any other attribute is toggled on the host and the body
   alike, as the body (what it is read from) has it, with the force given to each. Fixed:
   `toggleAttribute("class", true)` replaced the page's classes by a class named `true`, and an
   attribute the editor had on the host alone (a `toggleAttribute("data-mode")` with no force)
   was taken off the host and put on the body. Also: `data-ed-drawn`, which the bench reads, is
   the core's: it marks the host once its page has drawn (a frame that only threw is no longer
   marked); `editor-frame` no longer writes the host, and `MountFrameOptions.frame` says so.
   `document-elements.test.ts` has 3 tests more (`class` toggled on keeps `dark` and adds no
   `true`, off clears the page's; an attribute toggled with no force alike on host and body;
   `style` toggled on keeps the body's style); the first two failed first. `frame.test.ts` has 1
   test more: the host is marked drawn once its page has drawn; it failed first.
9. **A frame mounted after a dev-server error is told it** (`packages/preview-core/src/frame.ts`).
   The preview keeps the dev server's last error until its next update (`notifyHmr`) and tells
   it to a frame mounted meanwhile, as it mounts, as `editor-frame` keeps it for a frame already
   mounted (step 10). Fixed: a frame opened after a dev-server error (scrolled into view, the
   prototype opened, a specimen drawn) showed no error and drew what it could until the next
   update, while the frames already open showed it. `Preview.reportError` says so.
   `frame.test.ts` has 1 test more: a frame mounted after an error is told it once as the dev
   server's, and one mounted after the next update is told nothing; it failed first. The file's
   tests end with an update, so an error one leaves is no other's.
