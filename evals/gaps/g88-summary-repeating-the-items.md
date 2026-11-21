---
id: g88
title: A summary panel repeating the marks of the items under it
kind: missed
status: open
found: 2026-11-21
source: the person, on fx-opus-new20 (decisions/new20)
skill: [SKILL.md]
sections: []
---

**What happened.** On the sprint board both runs put a summary over the columns that repeats what
the cards below already mark: blocked, a failing check, the urgent unassigned bug, a column over
its limit. Run 2 added a second panel of points per person in orange warnings. The person chose
run 1, the lighter, agreeing with the call: "one short line of what's stuck, not a panel".

**The skill now.** g16 (wontfix) closed the same fault on 3 November because a reviewer with the
shipped skill caught it; here no review ran, and the designer drew it both times.

**Proposed.** Nothing new in the skill first: rerun the board with the review step (ADR 0081, the
checks' findings to the designer) and see whether the repeat is caught. If it isn't, a Check row:
"A summary over items that repeats their own marks | One line of what needs action, or none".

**Test.** `fresh-sprint-board` and `fresh-sales-dashboard`, 2 runs each, Opus designing with the
skill on main: the lines of each summary that repeat a mark shown in the items under them. It
passes when no summary has more than one such line, in all four.

**Result.**
