---
id: p05
title: Compliance claimed without the check
kind: process
status: testing
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [SKILL.md]
sections: []
---

**What happened.** The lead reported that every reference's table held, without running them
row by row against each section.

**Proposed.** The check's output lists each row of each table it ran, as pass or fail, with the
evidence (a measured value or a crop). A claim can't then be made without the run.

**Test.** Audit the reports for claims that have no matching row.

**Result.**
- Decision of 2026-11-04 (made by the agent, as the person asked): stays open: what an agent claims in its last message shows only in a design round, not in recall.
- `design-before`, `design-after` (2026-11-04, Opus in the editor, 6 runs each): 3 of 12 last messages said the tables hold; each of those runs had read those references (its trace `cat`s them), and 5 said which references they didn't read or check. No claim without the reading, but no row-by-row record either. Stays open: whether the rows were run is still not in the output.
