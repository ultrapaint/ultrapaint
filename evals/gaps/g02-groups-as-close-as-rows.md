---
id: g02
title: Groups as close as their rows
kind: missed
status: done
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [references/spacing.md, references/patterns/navigation.md]
sections: [components-panel]
---

**What happened.** In the Components panel, the gap between two groups was about the gap
between rows, so the groups didn't read as separate.

**The skill now.**
- `spacing.md` ("Proximity shows the grouping"): "The gap between groups is at least twice the
  gap within one."
- `patterns/navigation.md` gives padding 16, 24 between groups and 4 within.

**Why it was missed.** The agents applied the rules they could check in the code: type roles,
tokens, no blue washes. A rule about the relationship between two gaps needs the rendered
screen.

**Proposed.** A measured check instead of a new rule. After rendering, read the computed gaps of
each list. Fail when the gap between groups is less than twice the gap within one.

**Test.** Run the measured check and the agent's self-review on the same screens. Compare what
each catches.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 0/2 (+1 partly), redesign-gaps 0/2 (+2 partly) (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): no wording caught it, even from 2× crops: it needs the measured check of the gaps between and within groups.
- Decision of 2026-11-03 (`decisions/recall-redesign-1`): build the measured check (the gap between groups against the gap within one), since no wording caught it.
- `measure-1`: 2026-11-04, `pnpm evals measure` flags it at ratio 3 (27px between the App and System groups, 10px between rows) and not at spacing.md's 2 (it measures 2.7); at 3 it also flags the same pattern in Changes, and nothing in Layers or Settings (runs/measure-1/summary.md). The threshold is the person's call.
- Closed 2026-11-04 by the shipped skill and the measured check: `spacing.md` now asks for at least three times the gap within a group between groups, measured between the text, and `pnpm evals measure` flags under 3× by default (the person's choice of ratio).
- `recall-closing-check-1`: 2026-11-04, caught: shipped 0/2 (+2 partly), closing-check 0/2 (+2 partly) (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
