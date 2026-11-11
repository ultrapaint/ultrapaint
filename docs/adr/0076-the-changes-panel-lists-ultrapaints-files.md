# ADR 0076: The Changes panel lists Ultrapaint's files

Status: accepted, 2026-11-11. Amends 0031 (the Changes panel reads git's status).

## Context

The Changes panel listed every file git calls changed, in two groups: the designs, and "Other
files". In a product's repository the other group is most of the list: the product's own code,
which a developer commits from their own tools. Asked whether it belongs there, the person said:
files that are not Ultrapaint's should not show by default. The design system's `DESIGN.md`,
which the editor writes and undoes (0027), was among the other files.

## Decision

**A file is Ultrapaint's when the editor writes it**: inside the designs directory, or the
design system's `DESIGN.md` (`design` in git's status). The panel lists those as Design files.

**The other files are listed only when asked**: a "Show N other files" button in their place,
and the group, when shown, has Hide at the end of its title. Hiding them unticks them, so a
commit takes only files in view. Commit stays where it was: on the files ticked, with the
setting on (0031).

## Consequences

- A product repository's panel shows the designs and nothing else until the person asks.
- Committing the product's code from the panel is still possible, one click further.
