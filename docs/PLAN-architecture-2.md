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
