---
id: g88
title: A summary panel repeating the marks of the items under it
kind: missed
status: done
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
skill on main: the marks shown in the items that a summary over them repeats, as a line, a chip
or a panel's row. It passes when no summary repeats one, in all four; one short line of what
needs action, naming no item's mark, passes.

**Result.**
- `fx-opus-g88`: 2026-11-23, the skill on main, 2 runs each, Opus in Claude Code designing. The
  board failed in 2 of 2: run 1 a row of three chips over the columns (the urgent bug, the
  blocked card, the failing check), run 2 a "Needs attention" panel of four marks and a panel of
  points per person. The sales dashboard passed in 2 of 2: its flagged deals are the list itself,
  not a summary over one. The review step was not run; the Check row was tried instead.
- `fx-opus-g88once`: 2026-11-23, `candidates/g88-once` (the skill on main with a sentence on
  `SKILL.md`'s "A value appears once": a mark is read on its item, one short line above or
  none), `fresh-sprint-board`, 2 runs, Opus in Claude Code designing: no summary in 2 of 2, the
  marks on the cards and over limit on the column's header.
- Decision of 2026-11-23 (`decisions/g88`): ship, as the agent called it. Shipped as that
  sentence in `SKILL.md`.
