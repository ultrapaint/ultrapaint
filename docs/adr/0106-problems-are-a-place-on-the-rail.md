# ADR 0106: Problems are a place on the rail

Status: accepted, 2026-11-19. Amends 0025 (the rail's and the place switch's sync dot), 0027 (where
the linter's findings are shown) and 0053 (the modes' rails).

> Amended by [0161](0161-a-look-adds-and-takes-out-variant-members.md), 2026-11-27: Problems also lists the instances of a variant member a system component's look takes out, under Components, its fix Move to… a member the look offers, in one undo step.

## Context

What DESIGN.md's linter (`@google/design.md`) found was listed under Foundations' guidelines, in
its own words, with nothing to do about it: "No 'primary' color defined. The agent will
auto-generate key colors, reducing your control over the palette." speaks of Google's tools, not
Ultrapaint's, and the person could neither tell what it cost them nor what to do. Only someone
already in Design System mode, scrolled to the list's end, saw it at all. A step the sync waited on
was a row over the same list and a pink dot on the rail and in the place switch, the agents' colour
put to another use.

## Decision

- **Problems is a place of the rail** (`problems`, `panels/problems.tsx`), in both modes, at the
  rail's foot over Changes, shown only while there is something to fix and kept while its panel is
  open. Its icon is the warning's colour, the error's when one is an error. Opening it changes no
  mode.
- **It lists everything that needs fixing**, grouped by where it is read from: the sync's waiting
  steps (Sync), a design system file that does not read, what `design.tokens.json` left out, and
  DESIGN.md's linter warnings and errors (information is not listed). The colours no component
  uses are one problem, not one each.
- **The linter is said again in Ultrapaint's words** (`lib/problems.ts`, `findingWords`): what is
  wrong, then what it costs or how to fix it ("No primary colour: agents can't tell which colour
  marks an action. Name the one your buttons use `primary`."). A message it does not know is kept
  as written, under its place.
- **Every problem has its fix.** A sync step's is **Review**, the Sync; every other one's is **Fix
  with agent**, a new chat drafted with the file's own words for it, which the person sends (ADR
  0074). **Fix all with agent** drafts one chat for all of them, offered when there is more than
  one.
- **A problem's menu shows it in its file and can leave it as it is.** **Show in file** opens the
  file in the person's code editor at the line of its place (`files.open`, the server's
  `CodeEditor`: `launch-editor` guesses the editor from those running, else `LAUNCH_EDITOR`,
  `VISUAL` or `EDITOR`, which it reads itself); one that runs in a terminal (vim, nano…) is refused,
  as the server has no terminal to give it and the library kills the last one it started. A warning
  an agent would fix can be ignored: **for me**, kept in the person's profile under a name of the
  project's own (`ignoredProblems:<repository>`, so one project's editor never writes over
  another's), or **for the project**, kept
  in its settings (`ignoredProblems` in `ultrapaint.config.json`) so the whole team stops seeing
  it. An error and a sync step can't be ignored. A problem is ignored by its id, which holds the
  file's words, so one whose words change (a contrast that moved) is listed again; ids of problems
  gone are dropped as the list is next written.
- **Settings › Design system lists what is ignored**, whose choice it was, and **Show again**; it
  says nothing is ignored while nothing is, so the place is found before it is needed.
- **The place switch carries the sign**: Design system shows the warning icon while there are
  problems, its tooltip their count. The sync's pink dot is gone from the rail and the switch.

## Consequences

- Foundations no longer lists findings, notes or the sync's waiting row; a file that does not read
  is still said over its list, as it explains what the list shows, and is also a problem.
- The editor is opened on the server's machine: over SSH it is the remote machine's, where no
  editor may run, and the request says none was found. The editor is the person's and outlives the
  request; the server neither waits for it nor stops it.
- A new linter rule shows in the linter's words until `findingWords` learns it.
