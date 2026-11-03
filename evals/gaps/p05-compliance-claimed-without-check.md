---
id: p05
title: Compliance claimed without the check
kind: process
status: open
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
