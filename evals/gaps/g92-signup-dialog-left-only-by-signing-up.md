---
id: g92
title: A sign-up dialog left only by signing up
kind: missing
status: done
found: 2026-11-23
source: gap p15's test, from up88-fx/fresh-river-charity/run-2 with its close X removed
skill: [references/review.md]
sections: [signup-dialog]
---

**What happened.** The river charity's sign-up dialog, opened from a clean-up day's Sign up,
has a title, the day, Name, Email, how many people and Sign up. It has no close X, and neither
Escape nor a click on the backdrop closes it. A person who opened the wrong day, or changed their
mind, cannot leave without signing up: the page behind stays out of reach.

**The skill now.** `SKILL.md`: "Every dialog, step and mode has a way out: Cancel, Back,
Escape." `references/kinds/dialog.md`: "Escape, the close X and Cancel all leave, and Cancel
leaves no trace." `references/usability.md`, "Every way in has a way out": "A dialog closes with
Escape, its close button and Cancel". `references/review.md`, U1: "A dialog, step or mode left
only by finishing it | Cancel, Back, Escape, a visible exit". `references/review.md`, Judging: "A
fix never adds an element the picture does not have".

**Proposed.** None of its own: the section is gap p15's test.

**Test.** Recall: a finding names the missing close X and its fix adds it.

**Result.**

- `p15-told`: 2026-11-23, caught: shipped+told 3/3, p15-fix-adds-a-needed-control+told 3/3 (opus, effort high; runs/p15-told/report.md)
- Decision of 2026-11-23: done, the skill unchanged: it catches the missing way out (`review.md` U1, `SKILL.md` "every dialog, step and mode has a way out"), and the section stays as gap p15's test of it.
