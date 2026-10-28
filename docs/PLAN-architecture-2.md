# Plan: deeper modules, the second review (2026-10-28)

Status: in progress. Follows [ADR 0037](adr/0037-deep-modules.md) and
[PLAN-architecture.md](PLAN-architecture.md), whose 18 steps are not proposed again. The terms are
in `GLOSSARY.md`.

## Why

A second review, after ADR 0037's steps, found what they left half-done and concepts still written
in several places: what each Sync side knows still sat in `DesignSystemService`; where a frame
goes on a canvas was decided in four places with two gaps; nine web stores wired themselves to the
server and only the project was read again after a reconnect; "selected here" had two rules and
"which breakpoint" six; the spacing scale and a length in pixels were still copied across five
packages and the web never used the token table; a project service could only be tested through a
socket. Each step gives one concept one module with an interface its callers and its tests share,
writes a failing test first for each bug the review suspected, and keeps every ADR's behaviour
unless the step says otherwise.

## Steps

### A. Server

1. **One composition root, a project test layer.** The application layer and the project layer
   are built in one module the server and the tests import (the hand-kept copies in
   `testing/tasks.ts` and `testing/threads.ts` go). `HostManager.layerTest` starts no preview,
   the host seam's second adapter; a `ProjectTest(fixture)` layer reaches any project service and
   the MCP toolkits' handlers in-process.
2. **One canvas layout module.** A pure module in a shared package places a new frame (counting
   its views), places views, names a view and lists a page's family; the server's pages modules,
   the MCP tools and the web's `computeFrames` call it. One gap. `PagesService.setFrame` takes
   sizes and views rather than a layout callback. Fixes a new frame landing on the rightmost
   page's views.
3. **The Sync sides own what they know.** `DesignSystemService` keeps the design (read, write,
   `setTokens`, `replace`, undo, one publish per change). A code side owns the code's tokens
   (the cached read, the all-or-nothing write, the agreement, the preview CSS); DESIGN.md's module
   owns its document, mirror and baseline; the Figma side owns its baseline file. The target
   tokens ("the design's, else the code's own") and the Figma "another file" rule are written
   once; `design-system-sync-rules.ts` splits into the plan and the sides' readings.
4. **Settings in force.** One server module applies settings (open, reopen or nothing, decided
   once) and publishes the project's info whenever what it is made of changes; the RPC handlers
   and boot call it. The web's `settings-actions` saves and refreshes the store in one place, and
   holds "detect, apply suggestions, create designs, save".
5. **Flows in the services, not the adapters.** A spec read from the code is linked by its
   service on every path; the newest Figma import's theme is read by one function; a commit
   publishes the git status from `GitService`; a page's deletion returns what it removed; the
   comments' author comes from `GitService.user`. The RPC handlers and MCP tools route.

### B. Packages

6. **The token table finished.** `token-table` owns the spacing scale (step from a name, a name
   from a step, a step from a length, the base in px with its one default, the named steps);
   `token-value` owns a length in px, `var()` resolution and `calc` on lengths. The copies in
   design-document, style-tailwind-v4, design-md, the server and the web go; the web reads token
   kinds through the token table.
7. **A node's style, cut at declarations.** design-document gives a node's CSS declarations per
   breakpoint, tokens kept by name; the Tailwind class writer maps declarations to classes and
   owns the variant prefixes. Layout rules are written once. Amends ADR 0024's `ClassWriter`.
8. **A built-in agent is one descriptor.** Each built-in agent (Claude Code, Codex) is one
   descriptor in `acp`: launch, adapter bundle, sign-in command and its parser, API-key variable,
   extra environment, releases. The desktop's agents, its parts script, its downloads and
   `MachineAgentId` derive from the list. Amends ADR 0031.

### C. Web

9. **Data the server pushes.** One module subscribes, reads, reads again at every connection
   open, and switches its source to a viewed snapshot; stores declare what they follow. Live and
   snapshot are its two adapters. `fakeApi` is typed and its `reset` resets.
10. **The selection, as its view draws it.** One selection module answers "selected here", the
    breakpoint a frame is at, and the selected nodes as their view draws them with their shared
    value; the inspector, the toolbar, the highlights and Layers read it. Fixes the toolbar's
    values inside a view and Shift-click across views of a page.
11. **How a thread is shown.** `threadView(thread)` gives busy, label, tone, waiting and failed;
    `attachmentsOf` builds a prompt's attachments. No raw status checks remain.
12. **Showing a left panel.** One `show(...)` verb unhides the left panel, leaves the prototype
    and delivers its request (a chat and its draft, a diff, a rename); the three request stores
    go.
13. **Layers' drop and reveal.** `layer-tree` decides where a drop lands (node-actions' `Place`)
    and which rows a reveal unfolds; `layers.tsx` draws and forwards.

## Built

1. **Composition root** (`apps/server/src/composition.ts`, the tests' side in
   `apps/server/src/testing/project.ts`). `Foundation` (the settings, the storage, the log, the
   events, the port and the preview's proxy), `projectLayer(settings, host)` (the open project's
   services, moved out of `project.ts`), `ThreadsLayer` (the threads, on a briefing, slash
   commands, a launcher and a sandbox given below them) and `ApplicationLayer(adapters)` (all of
   it, `SetupSteps` on top) are built in one module. `Adapters` are the seams that have a test's
   second adapter: `host` (`HostManager.layer`, or `HostManager.layerTest`, which spawns nothing
   and reports the preview stopped, then running at no address once started) and `agents`
   (`AgentLauncher` with `AgentSandbox`, or `ScriptedAgents` with `AgentSandbox.layerTest`).
   `server.ts` serves `ApplicationLayer(ServerAdapters)`; `ProjectManager.layer` takes the
   project layer it opens, so the root decides which preview a project gets. The MCP route
   exports `ToolkitHandlers`, the handlers of the editor's, Figma's and the setup's toolkits.
   `ProjectTest(options)` is `ApplicationLayer(TestAdapters)` with a project open on a fresh
   fixture (files written into it, settings over its own, git or not, the MCP server or not) and
   the toolkits' handlers; `ProjectFixture` gives its folder, its home, its settings and
   `reopen`. `callTool(toolkit, name, parameters, thread?)` runs a tool's handler as an agent's
   call reaches it, the parameters decoded and `CallingThread` provided, and gives its answer or
   its failure. The hand-kept copies go: `testing/tasks.ts` (`tasks.test.ts` runs on
   `ProjectTest`, its slash commands no longer built beside it) and `testing/threads.ts`'s own
   stack (`ThreadTest` is `ThreadsLayer` on `Foundation`, its stand-ins for the project, the
   briefing and the commands kept). Also: a project opened by the tasks' tests no longer starts
   the Vite preview. `project-services.test.ts` has 4 in-process tests: the project opens with
   the test preview, `PagesService` makes, renames and lists pages, `DesignSystemService` reads
   the code's tokens and sets one, and `list_pages`, `create_page` (refused) and `focus` (the
   calling thread's event) are called without a socket. The same calls through the harness take
   about 720 ms with its server and project up, in-process about 420 ms; a call once the project
   is open takes tens of milliseconds either way. The 23 harness test files stay as they are.
2. **Canvas layout** (`packages/contracts/src/canvas-layout.ts`, in contracts beside the frame
   types, which now depends on shared for `basePathOf`). `FRAME_GAP`, `boxesOf`, `frameRight`
   and `frameBottom` (a frame with its views), `placeFrame` (a new frame at the top, past every
   frame and its views), `canvasFrames` and `drawnFrame` (every page's frame as the editor draws
   it: the saved one, else the desktop's size in a row past the saved ones, in the pages'
   order), `sizeFrame` and `FrameSize` (a preset, pixels and the widths of its views),
   `viewsAt`, `viewIdFor` (`w390`, then `w390-2`), `placeView` (right of the page and its
   views, else below them and down past whatever is in the way) and `familyOf` (the base page
   with its variants and states). The server's new page, duplicate, variant and state, the
   `set_frame` and `delete_page` tools, the implement task's states, the editor's
   `computeFrames` and `addView`, and the page menu's drawings call it; `pages-layout`'s and
   `page-tools`' copies and the editor's `freeSpotFor`, `viewIdFor` and gap go.
   `PagesService.setFrame(canvas, page, size)` takes a `FrameSize` and sizes the frame where it
   is, or where the editor draws it when none is saved, rather than running the tool's layout
   callback. One gap, 80: every placement on the server and both views' gaps used it; 120 was
   only the editor's row of unplaced pages and `set_frame`'s frame for one, kept equal so the
   tool sized an unplaced page where the editor drew it, and both now read `canvasFrames`. An
   unplaced page is drawn 40 px closer to the one before it; nothing saved moves. Also: a new
   page's frame (`write_figma_frame`) and a page sized by `set_frame` with no frame saved
   landed on the rightmost page's views, and now go past them; `set_frame` puts such a page
   where the editor draws it (it took the first unplaced page's place, however many came
   before); the editor's row of unplaced pages starts past the saved pages' views; `set_frame`
   with only `views` keeps the frame's preset (it made it custom). `canvas-layout.test.ts` has
   30 table tests (extents, `placeFrame` on four canvases and never on a frame or view of a
   scattered one, `canvasFrames`, `drawnFrame`, `sizeFrame`, view names and ids kept, three
   `placeView` cases, the family of a base, a variant, a state and a page in a folder);
   `project-services.test.ts` has 2 failing-first tests through `ProjectTest` (`createWith` and
   `set_frame` past Home's view); `editor.test.ts` has 7 more (views in `computeFrames`,
   `addView` beside, numbered and below, on no frame, `removeView` with its selection,
   `applyLayout` for the open canvas, another and while a save waits).
3. **The Sync sides own what they know** (`apps/server/src/services/code-side.ts`,
   `design-md.ts`, `figma-baseline.ts`; the pure rules in `sync-plan.ts` and `sync-readings.ts`).
   `CodeSide` owns the code's tokens: `tokens` (the one read through the style system, kept until
   a stylesheet it came from changes, which DESIGN.md's mirror, the design system's values, Sync,
   its plan and its watcher, the sync tasks and the specs all use), `refresh` and `changes`,
   `scan`, `agreement(ds)` (the `codeSync` a write of the design saves), `comparison(ds)` (the one
   call of `compareCode`), `previewCss(ds)`, `write(changes, against)` (every stylesheet or none,
   a file written put back when a later one fails, the agreement moved against the design given)
   and `follow` (`codeTokens: auto`, once). `DesignMd` owns DESIGN.md: its `file`, the
   `document` as the editor shows it with what is held and the linter's findings, `mirror`,
   `toWrite` (a writer's document with its baseline), `follow` (the front matter brought up to
   the design system and its baseline moved, outside the undo history), `place`, `setSection`,
   `refresh` (the components' classes) and `changes`; `documentBaseline` makes every DESIGN.md
   baseline a design system is written with (a writer's document, the matches saved, the tokens
   taken, which forgets the matches). `FigmaBaseline` keeps the baseline waiting in the state
   directory; Figma's adapter keeps it in `design-system.json` once there is one
   (`saveFigmaBaseline`) and says what the last sync with a file agreed on (`figmaBaselineOf`, a
   baseline of another file being none), which the plan reads too. `targetTokens`, the tokens a
   side is matched to, is written once in `sync-sides.ts` and the `/sync figma` and `/sync
   design` tasks list it. `DesignSystemService` keeps the design: `get`, `refresh`, `scan`,
   `detect`, `codeOf`, `write`, `setToken`, `setTokens` and `replace`, 9 members where it had 17
   (`codeTokens`, `codeComparison` and `writeCode` are `CodeSide`'s, `mirror`, `placeDocument`
   and `setSection` `DesignMd`'s, `baseline` and `saveBaseline` Figma's adapter's). It publishes
   `designSystem` in one place, a loop that hears its two files, DESIGN.md and the code change,
   whoever changed them; the seven publishes after each write and the sync's watcher publishing
   the state it refreshed go. `withAgreement` leaves `design-system.json` as it is when the side
   agrees on the same values already, the check the code's and DESIGN.md's moves each wrote by
   hand. The plan (`driftOf`, `caseOf`, `planOf`, `summaryOf`, `codeCounts`) and the sides'
   readings (`designTokensOf`, `codeSide`, `figmaSide`, `documentSide` and their comparisons,
   `codeAgreement`, `figmaBaselineAfter`, `codeDirection`) are two modules; `namedDiffs` is the
   engine's. The adapters are `codeAdapter`, `figmaAdapter` and `designMdAdapter` (a
   `SideAdapter`), so `codeSide` is only the code's reading. `readTokens(` is called in one place
   where it was in six, and `{anchorDir, root, settings}` is built in three where it was in
   eleven (the other two are the preview's). `design-system.ts` is 438 lines where it was 1176
   (`code-side.ts` 332, `design-md.ts` 493, `figma-baseline.ts` 68); `design-system-sync-rules.ts`
   (782) is `sync-plan.ts` (397) and `sync-readings.ts` (379). The target tokens differed only on
   paper: the adapters' list kept the style system's defaults and the tasks' did not, but every
   use in the adapters (the engine's comparison and rules, Figma's baseline, the targets) took
   only the code's own, so no outcome changed; the one list takes the code's own. Also: the
   editor hears of a change once, about 50 ms after it (a token set with `codeTokens: auto` was
   published two or three times, the first before the call returned); placing DESIGN.md sets its
   baseline in `design-system.json` as the file has it rather than writing both files again, and
   leaves it as it was when they share no value; a Figma baseline waiting in the state directory
   is removed with `force`. `design-system-sides.test.ts` has 6 tests on `ProjectTest`: the code
   written all or nothing (a `fileSystem` option of `ProjectTest` fails the second stylesheet's
   rename, and the first is put back), the one read seen by every reader once a stylesheet
   changes by hand and the agreement moved by an import and an export, Sync's Figma comparison
   and the `/sync figma` task matching to the code's own tokens past Tailwind's defaults, Figma's
   baseline waiting, none for another file, then taken in by a design system written, DESIGN.md's
   baseline moved by placing and by the mirror, and `documentBaseline`'s matches kept, forgotten
   and saved before anything is agreed. `design-system-files.test.ts` has 1 more (`withAgreement`
   with the same values).
4. **Settings in force** (`ProjectManager` in `apps/server/src/project.ts`, the web's side in
   `apps/web/src/lib/settings-actions.ts`). `ProjectManager` owns the settings the open project
   runs as well as the project: `apply(settings, why)` (open when nothing runs them, open again
   when the project runs other settings, else leave it and only publish what changed), `set`,
   `persist`, `renameConfig` and `adoptDetected(repo)` (detect, apply the suggestions, adopt and
   open, unless someone set settings in the meantime), and it follows the configuration file
   itself. One sameness rule, the `Settings` schema's equivalence with a field left out the same
   as one set to nothing; the open project keeps the settings it was opened with. Whatever puts
   settings in force runs under one semaphore, so a save made while detection reads the
   repository lands before or after the detected settings, never between. The project's info is
   published from one place whenever what it is made of changes, and only when it did: the
   settings and where they are kept, the preview's status, a repository made (`GitService.changes`)
   and the user's profile (`ProfileService.changes`). `publishInfo` and `open` leave the interface;
   the handlers of `settings.set`, `settings.persist`, `settings.renameConfig`, `profile.set` and
   `git.init` only route, and `Boot` calls `apply` or `adoptDetected` (the detection, its logs and
   following the file moved out of `server.ts`). `ProjectTest` opens its project with `apply` and
   takes a `storage` option (`ephemeral`, an unsaved session in the fixture). On the web,
   `save(next)` saves and reads the project again, returning the problems; `saveToFile` does so
   for `settings.persist`; `detect(base, {keepDesignsDir})` gives what detection found and the
   settings it proposes; `setUpDesigns(next)` creates the designs directory and saves. The settings
   page, the setup dialog, Sync's "Detect and apply", its code-tokens switch, a new application
   and the save-to-file dialog call them, where they read the project again, patched the store by
   hand or did nothing. Also: settings that were the same but listed their keys in another order
   (`JSON.stringify` compared them) reopened the project, so saving detected settings as they were
   restarted the preview and dropped the undo history; a configuration file written again with
   the settings that run (an editor reformatting it) reopened the project too; saving detected
   settings now tells the editor they are saved; after Sync's "Detect and apply" or the
   code-tokens switch the editor kept the settings it had, since the `project` event reloads only
   when the repository, `configured` or `setup` changes. `storage.test.ts` has 2 failing-first tests
   through the harness (a file rewritten with the same settings keeps the undo history; saving
   detected settings keeps the project open and publishes `setup: saved`);
   `settings-in-force.test.ts` has 4 on `ProjectTest` (the same settings in another order keep the
   project and its history, other settings reopen it; detected settings saved and then a session
   saved to a file keep the project and publish `saved` and the file; a user's save racing
   detection is the one in force, and a later detection replaces nothing; the profile and
   `git init` publish the info). `settings-actions.test.ts` has 5 with `fakeApi` (Sync's detection
   applied and the switch leave the store as the server has it, failing first; a refused save
   changes nothing; setting up the designs creates the directory, then saves; saving to a file
   reads the project again).
