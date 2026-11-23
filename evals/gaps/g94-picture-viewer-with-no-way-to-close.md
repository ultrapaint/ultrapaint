---
id: g94
title: A picture opened larger with no way to close it
kind: missed
status: done
found: 2026-11-23
source: gap p15's test, from fx-opus-main23/fresh-changelog/run-1 with its close X removed
skill: [references/review.md]
sections: [picture-lightbox]
---

**What happened.** On the CI product's changelog, an entry's chart opens larger over the page,
under its title. The viewer has no close X, and neither Escape nor a click outside the picture
closes it. A reader who opened the chart cannot get back to the changelog: the page behind is
dimmed and does not scroll.

**The skill now.** `SKILL.md`: "Every dialog, step and mode has a way out: Cancel, Back,
Escape." `references/usability.md`, "Every way in has a way out": "a mode (editing, selecting,
full screen) shows how to leave it." `references/accessibility.md`: "Escape closes the open
overlay and returns focus to what opened it." `references/iconography.md`: "a close × on a modal
or banner". `references/review.md`, U1: "A dialog, step or mode left only by finishing it |
Cancel, Back, Escape, a visible exit". `references/review.md`, Judging: "A fix never adds an
element the picture does not have".

**Proposed.** None of its own: the section is gap p15's test.

**Test.** Recall: a finding names the missing close X and its fix adds it.

**Result.**

- `p15-told`: 2026-11-23, caught: shipped+told 3/3, p15-fix-adds-a-needed-control+told 3/3 (opus, effort high; runs/p15-told/report.md)
- Decision of 2026-11-23: done, the skill unchanged: it catches the missing way out (`review.md` U1, `SKILL.md` "every dialog, step and mode has a way out"), and the section stays as gap p15's test of it.
