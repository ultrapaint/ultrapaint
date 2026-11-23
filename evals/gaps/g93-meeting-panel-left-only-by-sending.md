---
id: g93
title: A New meeting panel left only by sending the invite
kind: missing
status: done
found: 2026-11-23
source: gap p15's test, from up88-fx/fresh-team-calendar/run-1 with its close X and Cancel removed
skill: [references/review.md]
sections: [meeting-panel]
---

**What happened.** The team calendar's New meeting panel, open beside the week, has a title,
a duration, the people, suggested times, a room and Send invite. It has no close X in its header
and no Cancel beside Send invite. A person who started a meeting and no longer wants it cannot
put the panel away: it stays, a third of the window, until they send an invite.

**The skill now.** `SKILL.md`: "Every dialog, step and mode has a way out: Cancel, Back,
Escape." `references/usability.md`, "Every way in has a way out": "Cancel leaves no trace."
`references/kinds/dialog.md`: "the footer stays pinned under a full-width hairline: a tertiary
link at the left, Cancel and Save at the right." `references/review.md`, U1: "A dialog, step or
mode left only by finishing it | Cancel, Back, Escape, a visible exit". `references/review.md`,
Judging: "A fix never adds an element the picture does not have".

**Proposed.** None of its own: the section is gap p15's test.

**Test.** Recall: a finding names the missing Cancel (or close X) and its fix adds it.

**Result.**

- `p15-told`: 2026-11-23, caught: shipped+told 3/3, p15-fix-adds-a-needed-control+told 3/3 (opus, effort high; runs/p15-told/report.md)
- Decision of 2026-11-23: done, the skill unchanged: it catches the missing way out (`review.md` U1, `SKILL.md` "every dialog, step and mode has a way out"), and the section stays as gap p15's test of it.
