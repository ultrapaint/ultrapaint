# ADR 0106: Problems are a place on the rail

Status: accepted, 2026-11-19. Amends 0025 (the rail's and the place switch's sync dot), 0027 (where
the linter's findings are shown) and 0053 (the modes' rails).

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
- **The place switch carries the sign**: Design system shows the warning icon while there are
  problems, its tooltip their count. The sync's pink dot is gone from the rail and the switch.

## Consequences

- Foundations no longer lists findings, notes or the sync's waiting row; a file that does not read
  is still said over its list, as it explains what the list shows, and is also a problem.
- A problem has no "ignore" and no "show in file" yet: the editor has no way to open a file, and an
  ignored warning would need a place to be kept.
- A new linter rule shows in the linter's words until `findingWords` learns it.
