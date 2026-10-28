# ADR 0037: One module for each concept that was written in several places

Status: accepted, 2026-10-28. Amends 0011 (the renderer is told of one host; the editor's bundle
starts in preview-core), 0019 (named snapshots are kept in the snapshot store) and 0032 (a key is
declared with its command; the key handlers no longer stay where they were). Plan:
`docs/PLAN-architecture.md`, steps 1 to 18. The terms are in `GLOSSARY.md`.

## Context

An architecture review on 2026-10-27 found the services well built and the friction in what
joins them. The same knowledge was written in several places: which list holds a token kind
(nine times; `listTokens` knew three kinds, so a text size or a shadow added in
`design.tokens.json` was dropped), the outcome of a side compared with the design (three times,
with two equalities, so a hex and its oklch form were "same" in Sync and "held" in the mirror),
"busy" (nine ways), "is this the page's code" (five places in three packages), a key (up to five
places). Modules shared mutable state as their interface (a thread's live session, mutated by
four files; the preview's current frame, five variables kept in step by hand). String protocols
nothing checked joined modules: slash commands one caller wrote and another parsed, the globals
the server's generated code calls in the page, the desktop's IPC channels with their types copied
three times, menu items found by string ids. And behaviour could only be tested end to end: a
thread through an agent process over the socket, the guards through `pnpm e2e:sandbox`.

## Decision

Each such concept has one module, with an interface its callers and its tests share:

- **The design system.** contracts' `token-table` is the only code that walks, adds, sets and
  takes out tokens; `token-value` reads, compares and prints a CSS value for every package; the
  server's `design-system-files` is the pure codec of `design-system.json` and
  `design.tokens.json` (ADR 0035's reading in one place); `sync-engine` compares a side with the
  design and moves its baseline, the code, Figma and DESIGN.md being side adapters over
  contracts' `agreement` rule.
- **Snapshots.** Named snapshots are refs of a `designs` namespace in the tool's snapshot store,
  the setup's being another namespace: one format, one garbage collection.
- **Agent threads.** `AgentLauncher` is the seam an agent is started through (the sandboxed
  process, or a scripted in-memory agent in tests); `ThreadSession` owns a thread's live state
  and moves its status through one transition; `PendingCards` owns the cards an agent waits on;
  `isBusy` is contracts'. A task is asked for by a typed request (contracts' `tasks`), the slash
  command being one way of writing it; one rule names a page; `SetupSteps` runs a setup step with
  its thread.
- **The preview.** `provenance` says whose code is calling, by a rule named for what each guard
  guards; contracts' `page-runtime` declares the globals the server's generated code calls, which
  preview-core installs typed by them; `turn` and `kernel` hold whose page code runs and install
  every patch in one order; the editor's `editor-frame` opens a frame (host, pool, freeze check,
  replay) and answers at once.
- **The editor and the shell.** contracts' `shell-bridge` is the table of the desktop's
  capabilities, the web's `Platform` typed from it; `location` holds where the editor is with the
  URL; a key is declared with its command and run by one listener; every edit to a node goes
  through `node-actions`; a menu item carries a typed action, run by one switch the compiler
  checks.

Seams with one adapter stay only where an ADR keeps them on purpose (the framework, the renderer
and the style system: 0011, 0024). Where a seam was added, it has two adapters: the agent
launcher (the process, the scripted agent), the snapshot store (designs, setup), the Sync sides
(code, Figma, DESIGN.md).

## Consequences

- A change of rule is one edit: a new token kind, a new colour space, a fourth Sync side, a
  guard's caller rule, a desktop capability, a key.
- Tests reach behaviour through the module's own interface: thread behaviour runs in the
  server's process on `TestClock` (twenty tests left the socket), the guards' rules run against
  recorded stacks, menus and node edits run through `fakeApi` and the stores, a test reads the
  generated page code for members no shape declares. `pnpm e2e:sandbox` stays out of CI.
- Behaviour changed where a copy had drifted, and is written in each step: tokens of every kind
  are listed; a Figma conflict settled by keeping the design is not asked again; a value taken
  from the code is in the design's units; a chord is exact; an Alt-drag copy into a wide view
  lands at its breakpoint; a canvas with views is not reopened at each change of its pages.
- What a future change reaches for has a name in `GLOSSARY.md`; a review that finds a concept
  written in several places again gives it a module rather than another copy.
