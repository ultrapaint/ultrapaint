---
id: g02
title: Groups as close as their rows
kind: missed
status: open
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
