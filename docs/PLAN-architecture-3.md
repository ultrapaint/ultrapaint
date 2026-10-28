# Plan: deeper modules, the third review (2026-10-28)

Status: steps 1 to 8 built, 2026-10-28, one commit each, under "Built". The other candidates
were investigated one at a time ("Investigated") and planned as steps 9 to 18, being built.
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

- The built-in skills (`apps/server/src/skills/`) still name tools by string; projects can replace
  them and the design evals may be tuned to their wording (step 1).
- Some tool answers only an agent with the tools reads still name tools as strings
  (`figma-import.ts`, `design-md.ts`, `design-system-setup-batches.ts`, the MCP route's
  instructions) (step 1).
- Past 30 checkpoints every turn runs a full `collect` of the snapshot store (step 2).
- The class writer can write a size keyword on any spacing utility (`gap-full`), which Tailwind
  does not compile (step 3).
- `usage-rewrite.rewrite` builds a token lookup per file (step 4).
- `toggleAttribute("class", true)` from the page's code adds a class named `true`; the web still
  writes `data-ed-drawn` on the host for the bench script (step 6).
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
