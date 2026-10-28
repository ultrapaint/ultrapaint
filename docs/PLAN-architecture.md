# Plan: deeper modules, from the architecture review of 2026-10-27

Status: in progress. One step per candidate of the review, built one after the other, each its
own commit. The decisions it takes are recorded in
[ADR 0037](adr/0037-deep-modules.md) when the last step lands, and in the ADRs a step amends
(named in the step). The terms are in `GLOSSARY.md`.

## Why

The review found the services themselves well built and the friction in what joins them: the
same knowledge written in several places (a token kind's prefix and list nine times, "busy" nine
ways, the rule for "is this the page's code" five times), modules whose interface is shared
mutable state, string protocols nothing checks (slash commands built by one caller and parsed
by another, globals the server's generated code calls, IPC channels copied by hand), and logic
that can only be tested end to end (thread behaviour through a child process, the guards through
`pnpm e2e:sandbox`). Each step below gives one concept one module, with a small interface its
callers and its tests share.

## Decisions taken for the open questions

- The steps keep every ADR's behaviour. Only ADR 0032's "the key handlers stay where they were"
  is reversed (step 16), and ADR 0019's snapshots change their storage, not what they are
  (step 5).
- Named snapshots kept in the old format are imported into the snapshot store the first time
  the snapshots are read (when the service starts, before anything lists them), then the old
  files are removed (step 5).
- The page runtime contract (step 10) declares the globals' names and shapes once and both sides
  import them. Reaching the guards through an import instead of a global is left out: the
  dependency-only loop check must stay standalone, and nothing measured asks for it.
- The renderer seam stays, by ADR 0011, with one adapter (step 13).
- The setup step runner (B3's second half) is part of step 8.
- `pnpm e2e:sandbox` stays out of CI (it needs a browser and a fixture's server); steps 9 and 10
  move what it can into unit tests instead.

## Steps

### A. Design system and tokens

1. **One token table.** A module in `packages/contracts` owns which list of `DesignSystem` holds
   each token kind, its name prefix, the spacing base and font sizes' line heights: flatten, add,
   set and remove by name, strip and lay over values. `listTokens`, `removeTokens`,
   `withTokenChanges`, `tokenValues`, briefing's `tokensOf` and dtcg's placement go through it;
   the adapters' prefix tables derive from it. Fixes the dropped tokens: a new token of a kind
   other than colour, radius or spacing was filtered out by `listTokens`.
2. **A pure codec for the design system's files.** Reading (`design-system.json`, the tokens
   file, the code's tokens, the current design system) and writing (the two texts) move out of
   `DesignSystemService`'s closures into one pure module; `dtcg.ts` is its format. Every member
   gets the design system through the same reading.
3. **One module for what a token value is.** Parsing a CSS value into a colour, a length, a
   duration, a number or other, with equality, unit conversion and printing, in a shared package
   used by the server, DTCG, DESIGN.md and Tailwind. One notion of "same value".
4. **One engine for a side compared with its baseline.** Code, Figma and DESIGN.md become side
   adapters (their tokens, how they match, where their baseline is kept); one engine computes the
   outcomes, the changes a user's picks make, and moves the baseline forward, with step 3's
   equality. DESIGN.md's mirror merge uses the same rule.
5. **Named snapshots on the snapshot store.** `Snapshots` becomes a `designs` namespace on
   `SnapshotStore`, keeping only its view of pages and canvases. Amends ADR 0019 (storage).

### B. Agent threads

6. **An agent-launcher seam.** A scoped service gives an `AcpAgent` for a launch: the live
   adapter spawns it, a test adapter is a scripted in-memory agent. `ServerConfig.layerTest`.
   Thread behaviour (queue, cancel, permissions, elicitation) gets `it.effect` tests with
   `TestClock`; a few end-to-end tests keep the fake agent process.
7. **A thread session module.** One module per thread owns the live state, the status
   transitions, the turn cursor, the queue and the cards the agent waits on (open, resolve,
   release all, remembered choices, shown count). `ThreadService` routes to it; "busy" is
   defined once in contracts and used by the server and the web.
8. **Typed agent tasks.** A tasks module takes a typed request (implement, adopt, sync, setup
   step, …) and returns the task's text and the thread's purpose, or a typed failure. The slash
   parser is one adapter in front of it; the handoff tool and the setup RPCs call it directly.
   One page-naming rule, shared with the MCP lookup. A setup step runner starts, stops and redoes
   a step with its thread, out of the RPC handlers.

### C. Preview sandbox and frames

9. **Provenance.** One module in preview-core owns the preview's base path (passed in), reading a
   stack, and the rules each guard needs, named by purpose, plus "this module is the
   repository's", which the desktop app shares. Tests run recorded stacks against each rule.
10. **A typed page runtime contract.** The globals the server's generated code calls
    (`__ultrapaintGuard`, `__edStyles`, `__edReload`, `__ED__`) and the module marker are declared
    once; the templates, preview-core and the desktop app import them.
11. **A sandbox kernel.** One owner for whose code runs (the turn) and for the order every
    window, document, head and body patch is installed in; the head and body redirects share one
    helper. `mountFrame` registers a frame once.
12. **An editor-side frame module.** One module opens a frame: host, pool, freeze check,
    interactive flag, skipped repeated draws, replay on re-attach, typed events and synchronous
    queries. The message translation of `FrameBridge` and the unused `HostMessage` variants go.
13. **The renderer interface has one host.** `RenderSetup`'s optional fields become required,
    the head fallback goes, and the entry module moves into preview-core. Amends ADR 0011.

### D. Web editor and desktop shell

14. **The shell bridge as one table of capabilities.** Each capability is declared once, with
    Schema'd input and output and whether a remote project shows it, in a package both apps
    import; a generic exposer in the preload and a generic server in main. The stuck-page
    watchdog becomes its own tested module.
15. **One location module.** Canvas, route, variant, active page, the URL and the remembered
    canvas, with "go to", "follow the frame", "went back" and "the pages changed"; nothing else
    writes the URL. The camera moves out of `editor.ts`.
16. **Key bindings declared once.** A binding (chord, scope, command) is declared next to its
    command; the key handler, the palette, the shortcut sheet and the menus read it. Amends
    ADR 0032.
17. **One owner for an edit to a node.** Every node edit (inspector, Layers, drag, clipboard,
    canvas) goes through `node-actions`, which applies the breakpoint rule of ADR 0036 and
    reselects; tested through `fakeApi`.
18. **Menu items carry their action.** Each item holds a typed action; fact gathering sits behind
    the same interface and is tested from store fixtures.

## Built

1. **Token table** (`packages/contracts/src/token-table.ts`). `TOKEN_TABLE` names each kind's list
   and prefixes; `allTokens`, `addTokens`, `removeTokens`, `withTokenChanges`, `stripValues`,
   `layValues` and `fillValues` are the only code that walks the lists. A new token of any kind is
   now listed where its kind goes (only colours, radii and spacings were). Also: `text-shadow-*`
   is a shadow, no longer a font size; `design-system.json` no longer keeps named spacings'
   values; briefing lists every kind; dtcg's `designTokensOf` is `designTokensDocument`. Left
   alone: Tailwind's palette namespaces and DESIGN.md's mirror, which are their formats' own.
2. **Design system files** (`apps/server/src/services/design-system-files.ts`). `readDesignSystem`
   (the two texts and the code's tokens: the tokens file wins, a legacy file's own values, the
   code's where neither has one, and why either file does not read), `readGivenDesignSystem` (a
   writer's JSON, the current design system's values before the code's), `writeDesignSystem`
   (the two texts) and `withAgreement` (a baseline set in `design-system.json`, outside the undo
   history). `DesignSystemService` keeps the texts in its cache and the read until the files or
   the code change; `get`, `mirrorDocument` and `settleWithCode` share it. `replace`, `save` and
   `placeDocument` write a design system already read, so nothing is filled. Also: a
   `design-system.json` taken away while a baseline was moved was written back empty; it now
   stays away.
3. **Token values** (`packages/contracts/src/token-value.ts`, in contracts as the one package the
   server, DESIGN.md, Tailwind and Figma import all depend on). `parseValue` reads a colour (its
   space and channels in that space's ranges, every space DTCG has plus CSS's named colours), a
   length, a duration, a number or other; `sameValue`, `toSrgb`, `toPx`, `inCodeUnits`,
   `printColor`, `printLength`, `isColor`. The server's `token-values.ts` is gone; dtcg keeps
   only its encoding, design-md its `calc()` and the units the format holds, Tailwind's scan its
   patterns for colours inside text, and Figma import's `normaliseColor` reads through it. Also:
   DESIGN.md's mirror, the code's agreement, the preview's overrides and the document's put-back
   compare as Sync does, so `#2b7fff` in DESIGN.md and Tailwind's `oklch(62.3% 0.214 259.815)`
   are the same rather than held; dtcg writes sRGB's `hex` beside every space (only sRGB, HSL and
   OKLCH had one) and reads named colours and hue units; durations compare across `s` and `ms`.
4. **Sync engine** (`apps/server/src/services/sync-engine.ts`, the rule for one value in
   `packages/contracts/src/agreement.ts`). `outcomeOf` and `agreedAfter` are the three-way rule
   and the agreement it moves to, written once; `compareSide`, `changesOf`, `settledKeys`,
   `agreementAfter`, `matchByRules` and `matchEntries` compare a `Side` (its tokens, its matches,
   what was agreed, whether it waits for the design's values), work out the changes each way the
   picks make, and check the matches given. The sides are adapters in `sync-sides.ts` (the code,
   Figma, DESIGN.md: where each is read, written and its baseline kept, in its stored shape),
   with their pure readings in `design-system-sync-rules.ts` (`codeSide`, `figmaSide`,
   `documentSide`, `codeAgreement`, `figmaBaselineAfter`); `DesignSystemSyncService`'s `tokens`,
   `apply` and `match` are one path for all three, and `settle`, DESIGN.md's apply and
   `mergeMirror` move their baselines through the same rule. `outcomeOf`, `codeOutcomeOf`,
   design-md's `outcomeOf`, `tokenChanges`, `codeChanges` and `FigmaSide` go. Also: a Figma
   conflict the user settled by keeping the design's stays settled (it was asked again), and a
   token the design system took out is no longer offered back from Figma after the next sync;
   a token DESIGN.md takes out is written back by the mirror rather than held, as the code gets
   one back on export; a token the design system took out that the code still has as agreed
   waits for the code (an export takes it out) rather than asking; the code's values are taken
   in the design system's units, as Figma's and DESIGN.md's were.
5. **Named snapshots on the snapshot store** (`apps/server/src/services/snapshots.ts` on
   `snapshot-store.ts`). A named snapshot is a ref of the `designs` namespace named by its id,
   whose note is its name, date, file count and repository; its files are the store's, kept
   once by their contents. `create` is `recordContents`, `delete` is `release` and `collect`,
   `diff` and `restore` go through `changedFrom` (the files that differ between a snapshot and
   files given) and read only what changed; `restore` still writes through the undo journal,
   as one step, so it does not use the store's own `restore`, which writes past it. `Snapshots`
   keeps the designs' view: `view`'s pages, canvases, layouts and documents, the comments it
   leaves out, the repository it was taken in. The store gains `recordContents` (files given
   by their contents, optionally under a name of the namespace's own with a note),
   `named` (a namespace's named refs) and `changedFrom`; `release` takes a ref's name, and
   `collect` reads what a named ref keeps, removing nothing when a ref does not read. The old
   format's files under `<state>/snapshots` are imported when the service starts, with their
   ids, names and dates, and each is removed once it is in; one that does not import stays and
   is logged, and is tried again at the next start. Also: two snapshots of the same files share
   their contents, and deleting one leaves the other whole.
6. **Agent launcher** (`apps/server/src/services/threads/agent-launcher.ts`, the agent a test
   plays in `packages/acp/src/scripted-agent.ts`). `AgentLauncher.launch` gives the `AcpAgent`
   of a launch (the agent's configuration, its repository, the designs it may write, and the
   handlers, made once its sandbox says how a command it asks for is confined) until the scope
   closes; the live layer makes the temporary directory and the session's sandbox and spawns, as
   live sessions and discovery each did, and both ask it now. `makeScriptedAgent` is an
   `AcpAgent` in memory: an `AgentScript` for what it answers before a prompt (a start that
   waits, `session/load` and its replay, signing in, the options and modes offered), each prompt
   a `ScriptedTurn` the test plays (`update`, `say`, `think`, `requestPermission`, `elicit`,
   `cancelled`, `end`, `fail`), and `exit`, `stopped` and the calls it received.
   `testing/scripted-agents.ts` puts it behind the launcher; `testing/threads.ts` builds
   `ThreadService` in-process on a fixture, with stand-ins for the project, the briefing and the
   slash commands, and waits on the store's events (`threadWhen`). `ServerConfig.layerTest`
   replaces the configurations the tests wrote out in full, and `AgentSandbox.layerTest` is a
   machine without a sandbox. `thread-session.test.ts` has 32 tests on `TestClock` (the start
   and the handshake, a turn, the queue, cancelling while booting and mid-turn, permissions,
   questions, switching agents, an agent that exits, the project closing, discovery and its
   timeout); `threads.test.ts` keeps 16 through the fake agent's process, the SDK and the
   sandbox, and `thread-lifecycle.test.ts` went into the two. The tests' polls go through one
   `waitFor` (`testing/wait-for.ts`), and the harness's `waitForThread` on it.
7. **Thread session** (`apps/server/src/services/threads/thread-session.ts`, the cards in
   `pending-cards.ts`, `isBusy` in `packages/contracts/src/threads.ts`). `ThreadSessions.of`
   gives a thread's `ThreadSession`, made the first time it is asked for and forgotten with
   `delete`; it alone holds the live ACP session (briefed, replaying, resumed), the turn on its
   way, the agent booting, the turn's cursor, the queue and its three locks, and writes the
   status, through `statusAfter` (a prompt, a cancel asked, a cancel that outlived its turn, a
   turn's end, a failure, an exit, the session closing, the agent switched). `PendingCards` opens
   and awaits each kind of card (`permission`, `elicitation`, `ask`), resolves one by its id
   (`choose`, `answer`, which gives a card the agent did not wait on back as the prompt's text,
   `decline`), lets go of all of them (`releaseAll` on a cancel, `endSession`, which also forgets
   the choices remembered), and keeps the count of cards shown behind `formSent`, `declinedSeen`
   and `canWait`, which `ask_user` asks instead of `cardsShown` and its own set of threads.
   `ThreadService` makes threads, switches their agent and routes the rest to the session;
   `cardsShown` leaves it. `live-sessions.ts` is gone: the session's start went into the
   session, and opening the ACP session on the agent (load or new, signing in, options and mode)
   into `agent-session.ts`. `turns.ts` keeps what a prompt sends (attachments, the task, the
   briefing and recap, the title and scope); `agent-client.ts` keeps the host's file and terminal
   handlers. `projectUpdate` returns the turn's cursor after the update rather than moving the
   one it was given. `isBusy` (running or cancelling) is the server's queue, agent switch and
   health count, and the web's composer, pickers, questions, comment sending, context menus and
   chat list. `starting` and `closed` are never written and stay in the schema, with a note.
   `pending-cards.test.ts` has 10 tests on the cards' interface; `thread-session.test.ts` gains
   the status rules and a cancel with no turn under way. Also: the chat list shows a thread that
   is being stopped as working, as the composer did; a cancel of a thread that failed no longer
   writes "cancelling" over its failure while the turn's fiber unwinds.
8. **Typed agent tasks** (`apps/server/src/services/threads/tasks.ts`, the requests in
   `packages/contracts/src/tasks.ts`, the page-naming rule in
   `apps/server/src/services/page-names.ts`, the step runner in
   `apps/server/src/services/setup-steps.ts`). `TaskRequest` is a tagged union of every task an
   agent is given: `Init`, `Implement` (a target, a canvas to narrow a URL), `Adopt` (canvases
   and pages), `ImportFigma`, `Redraw`, `Components`, `SetupStep` (a step, Define's mode) and
   `Sync` (a source, or none for where the sync stands), each with what the user adds;
   `taskPurpose` is the one rule for what a thread running it is for (implementing writes the
   code, adopting does not). `AgentTasks.task` turns a request into `{ text, purpose }` or a
   `TaskFailure` whose `message` says why (no page is `/nowhere`, the pages are …; a step that
   works through the MCP server on a server without it) and whose `next` says what to tell the
   user; a failure without `next` (no project open) is the project's. The slash command is one
   adapter: `parseCommand` reads a prompt into a request (or a step that is not one, or null for
   a prompt the editor does not know), `commandOf` writes a request back as the command, and
   `SlashCommands.expand` gives the task with its purpose, a failure written as a task that tells
   the user why, or, with no project, what was typed. `turns.ts` takes the purpose from it (its
   `IMPLEMENT_RE` and the web's go), the handoff tool asks `AgentTasks` for a design's task and
   returns the failure's reason, and `/init`'s task moved from `commands.ts` into `tasks.ts`.
   What an agent does with and without the editor's MCP server is written once per capability
   in `agent-ways.ts` (`agentWays(mcp)`: reading the theme, saving the design system, editing a
   canvas's pages, the briefing's tools, marking a design implemented, linking a page built
   already, exporting, importing and settling tokens, noting behaviour, finishing a setup step),
   with `HANDOFF_ACTIONS` and `handoffCall` naming the tool's actions for its schema and every
   text; the task modules and the briefing keep only whether a step exists without the tools.
   `pageNamed` is the page a name means for the MCP lookup and the tasks alike: a URL names the
   base page (a variant's is named by its file; a state's page serves no URL, so the two rules
   did not differ there), a file, path or id any page, nothing the only page, a canvas narrows,
   and a name pages of several canvases answer to is ambiguous rather than the first.
   `SetupSteps` sits above `ThreadService` and `DesignSystemSetupService`: `start` creates the
   step's thread, starts the step with it and deletes it when the step does not start, and
   returns the step's first task as a request; `stop` and `redo` stop the turns of the threads
   they move first. The RPC handlers route to it, and `code.write` to
   `DesignSystemService.codeOf`. The web starts every task with `startTask(request)`, which
   writes `commandOf(request)` in the new thread's composer for the user to add to, as ADR 0023
   and the Implement buttons had it, and creates the thread with `taskPurpose`; a step's thread
   gets the task `dsSetup.start` returns. The prompt RPC still takes text: what the web starts
   is a draft the user edits before sending, so it stays a command the server parses. Tests:
   `tasks.test.ts` reads each request's task on a fixture in-process (`testing/tasks.ts`), with
   and without the MCP server, its purpose, its failures and the slash adapter's renderings;
   contracts' `tasks.test.ts` the parser and the printer, each request read back as written;
   `page-names.test.ts` the naming rule; `setup-steps.test.ts` the runner on the in-process
   threads (a step that cannot start leaves no thread, stopping a step stops its turn).
   `threads.test.ts`, `design-source-links.test.ts` and `design-system-setup.test.ts` keep one
   end-to-end path each (a slash command, handoff's read, a step's thread). Also: `/implement`
   with a URL that pages of several canvases serve says so rather than implementing the first
   listed, and takes `canvas:/url`, which the Implement button writes; the failures of the tasks
   read as one sentence (`The user ran /redraw, but there is no canvas "nowhere"; the canvases
   are …. Ask which one.`); `/import-figma` without the MCP server is refused as Map is, rather
   than given the import's directory; a tool given an empty page name in a project of one page
   gets that page, as `/implement` did; the no-MCP texts of Sync's code step and of a page's
   tokens say the same thing (write the value, or have the user press Export).
9. **Provenance** (`packages/preview-core/src/provenance.ts`, the server's side in
   `packages/framework-react-vite/src/guard-code.ts`). `createProvenance({ base, ownScript,
   stack, readModule })` is given the base when the preview starts (`createPreview`, from the
   designs' root), not set by `routePortals` as it went by; its doc comment states the assumption
   every rule rests on: the editor's code in the preview is one file, the bundle, whose frames are
   the editor's wherever they are, any other module under the base the page's. The rules are
   named by what a guard needs, each with its reason and the sandbox plan's step: `windowCall`
   (the first caller outside the bundle: listeners and `on*` handlers, scroll, history, the head
   and the title, popups on the body, `matchMedia` and the window's size), `scheduling`,
   `storage` and `domWrite` (the immediate caller, one frame: timers and animation frames,
   storage, `<html>` and `<body>`), `request` (the whole stack, down to where the editor handed
   over); `thrownAt` is where an error was thrown and `sourceLine` its source's line, through
   `source-lines.ts`'s `mappedLines(read)`, which replaces its `fetch` and its cache of modules
   kept for the page. `readStack` reads V8's frames (and SpiderMonkey's); `fileUnder`,
   `isRepositoryUrl` and `isRepositoryModule` (the address under the base, not a dependency's or
   the dev server's, and the server's mark in its code, `MODULE_MARK`) are pure and imported by
   the desktop app. `portals.ts` keeps only the popups, `calledFromPreview`,
   `calledDirectlyFromPreview`, `calledOnlyFromPreview`, `previewCallOn`, `thrownInPreview` and
   `previewBase` go, and with them sandbox's three swappable copies and the `OWN` of sandbox and
   `media.ts`; `installGuards(provenance)`, `routePortals(provenance, …)`,
   `guardRequests(provenance)` and `guardMedia(provenance)` take it. The test seam is the stack:
   a test gives `stack` a recorded V8 stack and runs the real rules. `provenance.test.ts` runs
   nine recorded stacks (the editor's alone, the page's alone, the page's called back through
   the bundle, the bundle called by the page, a dependency under `node_modules/.vite` handed its
   work through the bundle, the page's wrapper called by the editor, the editor's code inside
   the page's callback, the browser's own frame first, an edited module with its map inline)
   against every rule under `/preview/` and a base of three segments, the live V8 stack once,
   the thrown position mapped back through an inline map, and the repository's modules;
   `sandbox.test.ts` drives its guards with recorded stacks and gains one test a rule (a
   listener and a timer the bundle adds for the page's code, the first the page's, the second
   the editor's; a request through the page's wrapper; storage; `<html>`). The desktop app's
   `stoppedAt(stack, read, base)` asks the shared predicate and names the path under the whole
   base, which it takes from `PREVIEW_BASE`, now in `packages/contracts/src/preview.ts` for the
   server and the app. `guardedKind(id, editorDirs)` moved out of `serve.ts`, which runs as it
   is imported, into `guard-code.ts`, and is tested. Also: a frame is the page's when its
   script's path starts with the base, not when its line holds the base anywhere; the file an
   error names is decoded (`my page.tsx`, not `my%20page.tsx`); the desktop app reads only the
   modules under the base of a stuck page's stack, not the editor's own; `guardedKind` tells the
   dev server's code by the file's path with its separators made `/`, as it did the rest.
   `pnpm e2e:sandbox` passes its 23 checks.
10. **Page runtime contract** (`packages/contracts/src/page-runtime.ts`, in contracts as the one
   package the preview's server, preview-core and the desktop app all depend on; it imports
   nothing, so neither side takes the other's code). It names each global the generated code calls
   (`GUARD_GLOBAL`, `STYLES_GLOBAL`, `RELOAD_GLOBAL`, `REGISTRY_GLOBAL`), declares its shape
   (`PageGuard<Frame>`, `PageStyles`, `PageReload`, `PageRegistry`, together `PageRuntime`), lists
   each shape's members in a record `satisfies`-checked to hold every one and nothing else
   (`GUARD_MEMBERS`, `STYLES_MEMBERS`, `REGISTRY_MEMBERS`, all in `PAGE_RUNTIME`), and holds the
   module mark (`MODULE_MARK_NAME`, the name the repository's modules call `moduleStarts` by, and
   `MODULE_MARK`, moved out of `provenance.ts`). `installPageRuntime(globals)` defines globals
   through `PageRuntime`, so a guard, a stylesheet hook or a registry that drifts from its shape
   does not compile; `pageRuntime()` reads them. The templates interpolate the names and the
   members: `GUARD_MODULE` calls `globalThis.__ultrapaintGuard` directly in each function rather
   than through its `preview()`, `patchClient` the styles' `update` and `remove` and the reload,
   the registry `setComponents`, and `guardCode` writes the mark from the constants. preview-core's
   `answerGuard`, `installHooks` and `createPreview` define theirs with `installPageRuntime`
   (styles' `Hooks` and `HookedGlobal` go), provenance's `isRepositoryModule` and with it the
   desktop app's `stoppedAt` find the mark through it, and framework-api's `ComponentRegistry` is
   its `ComponentModules`. The calls stay calls on globals, as decided. `page-runtime.test.ts`
   reads the guard module, Vite's own client as patched and the registry for every global of
   ours they read and every member they call on one (`.__ed…`, `.__ED__`, `.__ultrapaint…`), and
   checks that the contract declares each and that each calls all its global's members; a member
   renamed in a template fails it, one renamed in the contract fails the typecheck. The tests
   that wrote the names out (`vite-client`, `sandbox`, `provenance`, `stopped-at`) take them from
   the contract. `pnpm e2e:sandbox` passes its 23 checks.
11. **Sandbox kernel** (`packages/preview-core/src/kernel.ts`, the turn in `turn.ts`, the
   redirect in `insertions.ts`). `turn.ts` holds whose page code runs, once: the frames mounted
   (by host), the frame asked about last (`askedFrame`: drawing, drawn by the editor, taking input
   or called back), the one whose callback a guard calls (`carriedFrame`, and `turnFrame` for
   either), the one whose `scroll` or `resize` is told (`relayedFrame`, through `relaying`), and
   the watchdog's notice (`onRunning`, told on every `ask`). `ask(frame)` and `runAs(frame, f)`
   are the only writers; the guards, `media.ts`, `portals.ts` and `<html>`/`<body>`'s writes read
   it. `install({ base, … })` takes `ProvenanceOptions`, makes the provenance and puts every patch
   in place behind one flag, in an order its doc comment lists with its reasons: the page runtime
   (styles and reload, the guard), what nothing caught, the window's and document's listeners,
   handlers, scroll and history, scheduling, requests and storage, the head and the sheets'
   `insertRule`, the body's popups and `<html>`/`<body>`, the window's size. Within it only the
   error listeners need to come before `addEventListener` is guarded; what matters is that it runs
   in `createPreview`, after the repository's modules and Vite's client first ran, as before. The
   generated entry's `editor-hooks.ts` before `host.css` is still needed (an entry's imports run
   before its body, and a stylesheet loaded before the hooks goes to the editor's head) and is
   explained in `preview-files.ts`. `register(frame)` adds a `Frame` (host, shadow, body, name,
   error, interactive, navigate, still) and gives one `FrameHandle` (`ask`, `unmount`);
   `mountFrame` uses it for the renderer's `drawing`, its input and `render`, and builds no
   `asking` of its own. Gone: frame.ts's `activeFrame`, `running` and `tellRunning`, sandbox's
   `frames`, `current`, `telling`, `carrying`, `runAs`, `installed` and `installGuards`, `GuardedFrame`
   (`FrameError` moved to `turn.ts`), media's `current` and `provenance`, portals' `installed` and
   `target`, css-in-js's `watching`, and media's unused `place`; sandbox's guards are exported for
   the kernel to call. `redirectInsertions(parent, elsewhere)` patches an element's `append`,
   `appendChild`, `insertBefore`, `prepend` and `removeChild`: a node inserted alone is offered to
   `elsewhere` with where it was asked to go, and one put elsewhere is taken from where it is when
   its owner removes it; the body's popups and the head's held styles and title, meta and icons
   use it. css-in-js's holder (an element, not a patch) is still made with the first held style.
   `frame.test.ts` mounts frames through `createPreview` with a renderer that runs the test's page
   code on recorded stacks: a popup, `prefers-color-scheme`, a document listener and a timer drawn
   in one frame are its together, the timer's after another frame drew, and the watchdog hears
   `a`, `b`, `a`; a frame the editor drew last without its renderer saying so gets the popups, the
   media query, the listener and `history.pushState` alike; a popup with no frame asked stays on
   the editor's body. `sandbox.test.ts` registers its frames with the kernel. Also: `render` makes
   its frame the turn for every guard, not only for popups, so `matchMedia`, `innerWidth`, a
   listener added, `scrollTo` and `history` in code that runs before its renderer says it draws are
   the frame drawn last, as its popups were; a frame's callback (a timer, a listener) opens its
   popups in that frame rather than in the one that last drew; a node kept aside from the head
   that its owner moved elsewhere is removed from there, as a popup was. `pnpm bench:canvas` on
   the Redesign canvas before and after: load 469 / 429 ms, pan 18–19% / 18–19% busy, zoom 40% /
   40%, Layers' select p50 108 / 111 ms, memory 771 / 771 MB. `pnpm e2e:sandbox` passes its 23
   checks.
12. **Editor frame** (`apps/web/src/canvas/editor-frame.ts`). `frameOf(id)` is the one handle on
   frame `id`, made the first time it is asked for and kept: `open({ canvas, holder, preview,
   className, style, keep, still, retryFrozenNextLoad })` puts its host in the holder, with
   `data-ed-frame-host`, drawn by the preview, or the host kept for it with the same preview and
   canvas, moved there as it is; it gives `{ host, close }`, or null for a frame the watchdog holds
   back (one that froze the editor), and with `retryFrozenNextLoad` (the pictures) tries it again
   at the next load. `close` parks a frame opened with `keep` that has drawn and throws any other
   away; a close of an earlier opening does nothing. The pool of `preview-pool.ts` (parking,
   `PARKED_MAX`, trimming the least recently seen, the load timeout, `isWarm`, `onPoolChange`) is
   in it, with `data-ed-drawn` written when a frame says it drew or threw. `listen(listeners)`
   takes one listener per kind (`FrameListeners`: `FrameEvents` and `ready`, told to a listener as
   it starts listening to an open frame and to every listener when the frame is opened anew) and
   `useFrameEvents(id, listeners)` is the hook over it, calling the listeners of the last render.
   `render` skips a draw the frame shows already; `hitTest`, `measure` and `tokens` answer at once
   (`screenshot` stays a promise); `watchRects`, `skeleton`, `setInteractive` (the runtime and the
   host's `pointer-events`), `setTitle` and `setAway` are kept and told again to a frame opened
   later, whether it was parked or thrown away. `useFrameFrozen(id)` is the freeze check the canvas
   frame draws its placeholder by. The canvas frame, `PreviewSurface` (the prototype, the type
   samples, a component's matrix) and the pictures open frames through it and no longer make
   hosts, call `mountFrame` or check the watchdog themselves; `PreviewSurface` draws `FrozenPage`
   for a frozen frame, so the prototype's own check goes. `bridge.ts` (`FrameBridge`, `bridgeFor`,
   `removeBridge`, its message translation and its `Promise.resolve`s), `use-frame-bridge.ts` and
   `preview-pool.ts` are gone, and with them the six switches on `msg.type`: the frame, the
   prototype, the hotspots, the pictures and both panels pass typed listeners. contracts'
   `HostMessage` and its Schema go (nothing decoded it; `ed:hit`, `ed:measured`, `ed:screenshot`
   and `ed:tokens` were sent by nobody), and `Rect` and `HostError` become interfaces. With
   synchronous answers, the hit tests and measures of the pointer, the drag, the create tool,
   pasting, comments, the menus and the type samples are called without `await` (eleven sites, and
   the functions above them: `hitUnlocked`, `dropAt`, `placementAt` and the pointer's handlers are
   synchronous), and the two queues that let only the latest lookup count (`moveDrag`,
   `followDrop`) and the hover's lookup counter go. `pnpm bench:canvas` still hears `ed:ready` and
   `ed:rendered` through the `ed:frame` event in development. `editor-frame.test.ts` drives the
   module with a fake `Preview` in happy-dom: the host and its attribute, answers before and after
   opening, the freeze check with and without the retry, what is told again to a frame opened
   later (rects, skeletons, input, title), the interactive flag on runtime and host, skipped
   draws and a draw again in a frame drawn anew, typed listeners and `ready`, the last render
   drawn, parking and taking back as it was, a frame closed before it drew and one not kept
   thrown away, replay after one was thrown away, another preview or canvas and a stale close,
   trimming beyond 32, and the load timeout; `bridge.test.ts` went into it, and `drag.test.ts`,
   `use-frame-pointer.test.ts` and `specimens.test.ts` run on it. Also: the type samples and a
   component's matrix show the placeholder when they froze the editor, rather than drawing again;
   what a frame watches or shows as skeletons is no longer lost when the pool drops the frame
   while it is away; a canvas frame kept from another preview is drawn anew rather than given
   back; a comment placed on the canvas or in the prototype is pinned to its element at once.
   `pnpm bench:canvas` on the Redesign canvas before and after: load 463 / 471 ms, pan 18–19% /
   18–19% busy, zoom 40% / 40%, Layers' select p50 80 / 91–112 ms (two runs; step 11 measured
   108 / 111), memory 749 / 767 MB. `pnpm e2e:sandbox` passes its 23 checks.
13. **One host for the renderer** (`packages/framework-api/src/browser.ts`, the entry in
   `packages/preview-core/src/editor.ts`, the setup in `render-setup.ts`). `RenderSetup` describes
   the frame of the editor's page and nothing else: `drawing`, `pageHeight`, `publicUrl`,
   `reportInstances` and `setDesignCss` are required, so renderer-react's `<style data-ed-design>`
   appended to the document's head when no core kept the design's sheet goes, with its fallbacks
   (a `drawing` that did nothing, `100vh` for a page's height, an identity `publicUrl`, a report
   of instances that could be left out). `renderSetup(input, options, frame)` makes the setup a
   frame mounts its renderer with (the assets' and public files' URLs, the height, the frame's
   events, the design's sheet), out of `mountFrame`, which gives it its turn and what follows a
   render. `editorPreview(render)` is the entry of the module the editor's page loads
   (`createPreview`, `installHooks`, `onReloadRequest`); `createPreview` takes the renderer as its
   first argument, and `PreviewSetup`, what the generated entry hands over, no longer holds
   `mount`. framework-react-vite's build pairs them, as ADR 0011's framework package does: the
   editor bundle's entry is two lines given to esbuild as text, preview-core's `editorPreview`
   called with renderer-react's `renderToCanvas` (the metafile's `<stdin>` is left out of the
   inputs that tell a stale bundle). renderer-react's `editor.ts` is gone and it imports
   `framework-api`'s interface alone: preview-core is a dependency of the framework package and
   only a development dependency of the renderer, for its test. `render.test.ts` draws with
   `renderSetup`'s setup, and reads the design's sheet where the frames adopt it, rewritten for
   them (`:root` is `:host`); `frame.test.ts` gives `createPreview` its renderer. The seams stay,
   with one adapter each, by ADR 0011, which is amended. The generated entry and the bundle's
   exports are as they were, so the server, the web and the desktop app do not change.
   `pnpm -F @ultrapaint/framework-react-vite build` builds the bundle, and a second build with
   nothing changed finds it current. `pnpm e2e:sandbox` passes its 23 checks.
14. **Shell bridge** (`packages/contracts/src/shell-bridge.ts`, the preload's side in
   `apps/desktop/src/bridge.ts`, the main process's in `bridge-server.ts`, the handlers in
   `handlers.ts`, the watchdog in `stuck-pages.ts`). `SHELL_BRIDGE` is one table of the desktop
   app's capabilities, each by its name, which is its path in `Platform` (`projects.open`): an
   `invoke` (a Schema'd tuple of arguments, a Schema'd answer, and for `newDesign.create` a
   `progress` it tells a listener given after them) or a `state` (a Schema'd value the main
   process holds and tells as it changes: `shellStatus`, `windowControls`), and whether a project
   on another machine shows it (`agents.*` and `notices` are this machine's). The shared types are
   its Schemas, once: `ShellStatus`, `StoppedAt`, `ShellNotice`, `PlatformAgent` (its `id` the
   `MachineAgentId` the app's `AGENTS` are checked to hold), `PlatformProject`,
   `RemoteProjectRequest`, `NewDesignInput`, `NewDesignStepId`, `NewDesignUpdate`,
   `NewDesignOutcome`, `WindowControlsState`; desktop's `NewDesignRequest` Schema, main's
   `RemoteRequest` and the copies in `ipc.ts`, `shell.ts` and the web's `platform.ts` go.
   `ShellPlatform` is the type the table gives (`Exposed` per kind, `Nested` by the dotted
   names), and the web's `Platform` is `Partial<ShellPlatform>` with `serverUrl`; `AgentSetup`,
   `ProjectSwitcher`, `NewDesigns`, `ShellStatusSource` and `WindowControls` are its parts, so a
   capability added, renamed or retyped in the table is what the editor compiles against.
   `exposeBridge(ipc, info)` builds the object the preload exposes from what the main process
   says is shown (`BridgeInfo`, asked synchronously as the page loads), each at its path, a
   state's value with it; it takes only the table's types, so the preload carries no Schema
   (bundled with it, loading Effect's Schema costs the page about 58 ms on every load; the
   preload is 2 KB, from 5). `bridgeInfo(remote, states)` is the one place a remote project hides
   this machine's capabilities, where the preload dropped `agents` and main emptied `notices`, and
   `answer` refuses them too (`HiddenCapability`). `serveBridge` registers every invoke from a
   `BridgeHandlers<R>` record, answers only the app's window, decodes the arguments by the
   capability's Schema (`BridgeInputError`, which the page reads as its message), runs the
   handler, encodes its answer and sends its steps to the caller. `bridgeHandlers(options)` is
   that record as plain Effects over the app's services: the `String(id)`s, the `isAgentId`
   checks and the hand decoding go, and the dialogs go through `Shell`, which gains `pickFile`
   and a `pickFolder` with a default path. `watchStuckPage(contents, read)` is main's
   `endStuckPages` as a scoped Effect over `WatchedContents` (answer a script, read the stack,
   end, reload, destroyed), its timers on the `Clock` (silent 4 s, a second to answer, half a
   second for the stack, a look every half second, now one after another rather than
   overlapping); main hands it Electron's contents and closes its scope with the window, and
   `stoppedAt` is the bridge's like any capability. `ipc.ts`, the preload's hand wrappers and its
   own status and full-screen listeners are gone. Tests: contracts' `shell-bridge.test.ts` (a
   group is shown or hidden whole, what a remote project hides, no deeper nesting);
   `bridge-server.test.ts` (input its Schema refuses, an unknown agent, a field missing, the
   handler given the input decoded, a remote project's hidden capability, the steps encoded, a
   failure's message, the information shown, only the app's window answered and the steps sent
   to it); `bridge.test.ts` (each capability at its path on its channel, what a remote project
   leaves out, a call's listener told until it is answered and not sent, a state as it loads and
   as it changes); `handlers.test.ts` on `fakeShell`, the fake servers and the services' layers
   (projects listed and opened, a remote project's problem and opening, local or remote, an
   agent's path picked or cancelled and the server started again, a blank key forgotten, the
   folder picker's title, a new design's steps, notices, the stuck page, the SSH hosts);
   `stuck-pages.test.ts` on the `TestClock` (a page that beats, one ended past the limit with its
   line kept once and loaded again once, a stack Chrome could not read, a silent page that answers,
   one that beats again in time, a window destroyed while asked, the scope closed mid-check,
   Chrome's hang monitor). Also: an agent id the app does not know is refused rather than
   ignored; `notices` is not given to a remote project's editor rather than answering nothing;
   the window's buttons are `windowControls.current()`, one state, rather than `fullScreen()`
   and `inset`; a project switcher always has `add`, `addRemote` and `sshHosts`. The app run
   hidden on `fixtures/sandbox-host`: the editor loads, the platform holds every capability but
   `windowControls` (Linux), `projects.current` and `list`, `agents.list`, `notices`,
   `stoppedAt` and `shellStatus` answer, a wrong argument comes back as `BridgeInputError`, and a
   page held by a loop is ended and loaded again, the editor writing the stack it was stopped at.
15. **Location** (`apps/web/src/state/location.ts`, the camera in `apps/web/src/state/camera.ts`).
   Where the editor is (the canvas, the route, the variant and `activePage`) is one fact, and
   `location.ts` alone writes it, through one `arrive(place, history, also)` that sets the place
   with what changes with it and writes the URL to match, a page in it only at no URL; the URL and
   the canvas remembered for the next start (`ultrapaint:canvas`) are its persistence, and
   nothing else calls `writeUrl`. The four stay fields of the editor's store, so that a canvas
   opened is one change with its frames and the forty-odd modules that read them read one store.
   `goTo({ canvas?, page?, route?, variant? }, { push? })` is the one verb: with a canvas it opens
   it (its layout read again when it is the one open) where `landingOf` lands, in a variant it
   has, replacing the entry; without, on the open canvas, a page by its id (at its URL when it has
   one, in its variant; one already shown at its URL stays on the parameters it was reached
   with), a URL in the variant given or the one the editor is in, or a variant alone, the same
   place drawn in it, each an entry of the history unless `push` is false. `followFrame(frame)`
   (the page selected in, from `select` and `selectPage`), `pagesChanged()` (a canvas deleted
   while open gives way to the first left, a page added or gone opens the canvas again where it
   is, otherwise the editor catches up: a page shown without a URL that has one now is at it, one
   that is gone gives way to where the canvas opens, the page serving the route is the list's),
   `openStartCanvas()` (the canvas the URL names at its place, the one remembered, or the first)
   and `followHistory()` (back and forward: `wentTo(url)`, the canvas of the entry opened at it,
   then the workspace written back) replace. The policy is written once in its doc comment: a
   navigation pushes and lets the selection go (`unpicked`, from `editor.ts`, in the same change);
   opening a canvas, following a frame and catching up replace and, but for the canvas, keep the
   selection. The store's `navigate`, `openCanvas`, `openPage`, `setVariant` and `syncActivePage`
   go, with `OpenAt`, `pageAt`, `landingOf`, `opening`, the eight `writeUrl` calls and the five
   copies of the selection's reset; `editor.ts` keeps how it holds a canvas (`layoutOf`, a
   snapshot's or the server's, and `openedCanvas`: frames, nothing held or measured, nothing put
   aside from another canvas). app.tsx's three effects are calls (`openStartCanvas`,
   `pagesChanged`, `followHistory`), and back's `useEditor.setState({ variant })` goes. The camera
   (`pendingView`, `viewFrame`, `flight`, `flyTo`, `fitTo`) is `camera.ts`'s, the only writer of
   `view`: `setView`, `setViewSoon`, `nextView`, `viewTarget`, `zoomToFit`, `zoomToSelection`,
   `useInv`, `View` and `Viewport`; `canvas/camera.ts` still draws it. editor.ts goes from 1160
   lines to 733, app.tsx from 559 to 494. The dev handle gains `goTo`, `setView` and `zoomToFit`,
   which `pnpm e2e:sandbox` and `pnpm bench:canvas` drive instead of the store's. The URLs are as
   they were. Tests: `location.test.ts` (34) on the fake browser, whose history now keeps its
   entries and tells `popstate` on back and forward, checks after every verb that the URL and
   `activePage` agree with the place: the start from the URL (a URL, a page without one, the
   designs directory's canvas named by a route alone), from the canvas remembered, from neither, a
   URL naming a canvas, a page or a URL that is not there; pushing and replacing; a page in its
   variant, a variant alone, a page already shown; a canvas opened, the last asked for, a move
   saved to the canvas it was made on; back and forward restoring the page, the URL and the
   variant, opening an entry's canvas, keeping the workspace; following a page, a view, a page
   without a URL and a node on the canvas; a canvas deleted, a page added, given a URL or gone, the
   page serving the route changed. `pnpm e2e:sandbox` passes its 23 checks. `landingOf`'s, `followFrame`'s and `openCanvas`'s tests moved
   from `editor.test.ts`, and `setViewSoon`'s into `camera.test.ts`. Also: the page list changing
   no longer opens again a canvas whose pages have views (a view's frame counted as a page that
   was gone), which read its layout again and let the selection go each time; a page shown without
   a URL that is gone gives way to where the canvas opens rather than leaving no page with the URL
   still naming it; a page already shown at its URL in another variant writes the variant to the
   URL too.
16. **Key bindings** (the bindings in `apps/web/src/lib/commands.ts`, the chords in `keys.ts`, the
   handler in `keymap.ts`). A command declares its keys with it: `keys` (the chords shown),
   `also` (the same, not shown: Delete beside ⌫, ⌘+ beside ⌘=, the menu key beside ⇧F10) and
   `scope`: `always` (in a text field too: ⌘K, ⌘\, the workspace keys, the menu key), `editor`
   (outside text fields, in either workspace) or `canvas` (outside text fields, on the canvas). No
   key works while a dialog, a menu or the settings page is open, as before. The command list is
   one table built once, each command with `offered` (whether the palette lists it now), a title
   read as the palette opens and a `sheetTitle`; the keys that act on the selection (duplicate,
   wrap, delete, edit the text, Escape, the arrows, the menu key) are commands the palette does
   not offer, and copy, cut and paste name the clipboard event the browser turns them into. A
   chord is written in words (`mod+shift+z`, `shift+1`, `?`, `f2`), parsed once by `parseChord`,
   shown by `chordLabel` the way the platform writes it (`⇧⌘Z`, `Ctrl+Shift+Z`) and matched by
   `matchesChord`: `mod` is ⌘ on a Mac and Ctrl elsewhere when shown, either when pressed (as
   before); a letter by what it types, and by its place with Alt; a digit by its place, so ⇧1 is
   whatever Shift types there; a symbol by what it types whatever Shift did (`?`), `'` and `\` by
   their place too; every modifier not named must be up. A chord that differs by platform is one
   for each (`{ mac: "ctrl+1", other: "alt+1" }`). `useKeymap` is the window's one listener
   (`pressWindowKey`: the scopes the key reaches, the binding of its chord, its command's `run`,
   the palette's own, and the default prevented unless it gave back false, as ⌘D with nothing
   selected does), with the clipboard's events. A focus scope's host passes what the key is pressed
   on: the Layers tree's keydown is `scopeKeyDown("layersRow", row)`, over `focusBindings.layersRow`
   (walk and fold, select, add, F2, ⇧⌘H, ⇧⌘L), whose keys go first and stop there. Menu items name
   the command they are (`command: "duplicate"`) and the menu, the palette, the sheet, the toolbar,
   the title bar and the Comments panel show `keysOf(id)`. `toolKeys`, `handleModeKey` (the second
   copy of C's two meanings: `pickTool` is the one), the eleven `handle…` functions of the old listener, `rowAction`,
   `keyOnlyShortcuts`, `commandsForSheet`, the menus' `shortcut:` strings, `shortcutLabel`,
   `keysLabel` of Mac strings and `holdsWorkspaceModifier` go; `shortcuts.ts` keeps what the keys
   do (`walkSelection`, `dismiss`, `editSelectedText`, `openSelectionMenuByKey`, undo, the zoom).
   The sheet gains a Layers section, which it did not list. Tests: `keys.test.ts` (labels on a Mac
   and elsewhere, each platform's chord, parsing and refusing, ⌘ and Ctrl for `mod` and ⌃ told
   from it, modifiers up, digits and letters by place, symbols whatever Shift did, named keys) and
   `keymap.test.ts` in happy-dom: every chord of every binding, built as a US keyboard presses it on
   a Mac and elsewhere (`testing/key-events.ts`), is its own binding in its scope and no other in a
   scope reached with it; pressed, it runs the command's `run` and prevents the default; the
   clipboard's are left to the browser; a Layers row's keys run on the row and stop, and one the
   row does not take, or pressed in a field of it, goes on; a text field keeps all but `always`,
   a dialog or the settings everything, the prototype the canvas's keys; C picks commenting and
   shows the comments on the canvas, goes in and out of it in the prototype, by the key and by the
   palette, and is not ⇧C; the sheet lists the Layers keys and every key once; every command a menu
   names has keys. Also: a chord is exact, so a tool letter with Shift or Alt, ⌘↩, ⇧↑, ⌥⌘Z,
   ⌥⌘', ⌘? and ⌘ with a Layers row's Enter no longer do what the plain key does; ⇧0 zooms to 100%
   on a US keyboard, where Shift types `)` there and it never did, and ⇧1 and ⇧2 on layouts whose
   Shift types the digit; ⌘⌫ deletes, as it did, as an `also` of Delete; the menu shows Enter as
   ↩, as the sheet does.
17. **Node edits** (`apps/web/src/lib/node-actions.ts`). It is the only caller of `applyEdits`: a
   caller names the nodes (`Selection`s) and the frame an edit is made in, a `Place` (`into` a
   frame's container at an index, or onto the `canvas` at a point), and node-actions lands it by
   ADR 0036 and selects what it made or moved (`selectLanded`, once). `insertNodesAt` (Assets
   drops, the create tool, pastes, Alt-copies, images), `moveNode` (drags, Layers drops, a node
   moved around the canvas), `resetAt` and `showBy` (named breakpoints, sent as they are) join
   the field, tree and arrange actions; text typed in place and a canvas node's resize are
   `updateNodes`. `applyOps`, `dropEdits`, `layerMoveEdits`, `insertAt` and clipboard's
   `insertAllAt` go. `node-actions.test.ts` (20) runs the stores on `fakeApi`, answered by the
   server's own `applyOps`. Also: an Alt-copy dropped into a view above the base is hidden below it, as a paste
   is; a Layers drop keeps the selection in the view it was in; a paste at a point is "Paste".
18. **Menu items carry their action** (`apps/web/src/lib/menu-model.ts`, `menu-actions.ts`). An
   item holds a typed action with its argument (`{ kind: "wrap", in: "row" }`, `{ kind: "copyTo",
   canvas: "", move: true }`), each menu's a union of its own; `menuFor(target)` reads the facts
   off the stores and binds the items to the target (`{ on, target, act }`), and `runMenuAction`
   runs one, an exhaustive switch a case per kind. The canvas menu's commands run the command's own
   `run` (`runCommand`). The six `actions[id]?.()` tables, `argOf`, the items' ids (an icon is told
   by the action, a submenu's by its typed id) and `viewCode` (`showRightPanel`, the palette's) go.
   `menu-actions.test.ts` (17) builds node, page and canvas menus from the stores on `fakeApi` and
   runs their items; a table every kind must be in, and a sweep running each once. Also: Hide, Lock,
   Resolve and Follow do what the menu said when it opened; a draft component's failure is shown.
