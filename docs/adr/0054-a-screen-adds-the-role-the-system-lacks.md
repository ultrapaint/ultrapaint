# ADR 0054: A screen adds the role the system lacks, and no job waits for Sync

Status: accepted, 2026-11-03. Amends 0049 (using a value, the components a job names) and 0050 (the
character written down).

## Context

The character rounds measured 0049 and 0050 in the design evals. On a host with a design system
and no status colours, a screen told the user the roles were missing and drew without them: the
"Done" rows a remade grid tints green became grey with a blue bar, and the statuses solid Badge
variants. Every extraction on Claude asked the user to run Sync for the components it had written
into the code, and one drew no sheet while it waited. The extracted DESIGN.md held the character
but not its dials.

## Decision

- A role a screen needs with no token (a status, a category's hue, a tinted row) is added to the
  design system with a line in DESIGN.md saying why, and the user is told. A token the system has
  but gets wrong stays the user's to change: the screen uses it and says so.
- A component written into the code waits for Sync to be placed, and nothing else does: the agent
  does not ask the user to run it, draws the job with the components the system has (or their
  parts), and says in its last message what Sync will bring in.
- An extraction's finish check asks for the character and its dials in DESIGN.md's Overview.
- Both live where every job reads them: the Sync rule in the router, the dials in `character.md`
  (told with it). In the rounds that followed, extractions on Claude seldom opened `extract.md` or
  `design-system/components.md`, and with the rules there they still asked for Sync and wrote no
  dials.

## Consequences

- Screens on a host with a system may grow its tokens; the evals put the host's DESIGN.md back
  before every run and when a round ends, removing one a run created.
