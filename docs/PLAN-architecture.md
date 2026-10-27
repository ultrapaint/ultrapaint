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
- The page runtime contract (step 11) declares the globals' names and shapes once and both sides
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
