---
id: g06
title: An inset panel drawing a double edge
kind: missed
status: done
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [references/spacing.md]
sections: [left-card-raised]
---

**What happened.** The first raised panel was inset 1px, with its own full border, inside the
card. That made two hairlines with a 1px gutter between them.

**The skill now.** `spacing.md`: "One edge is drawn once: never a line and a surface for the
same group."

**Why it was missed.** The screens were only looked at whole, at full size, where a 1px gutter
can't be seen.

**Proposed.** See P4.

**Test.** The same screens reviewed whole versus as 2× crops. Count the double edges found.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 0/2 (+2 partly), redesign-gaps 2/2 (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): the candidate caught it 2/2 through G5's wording (an edge only where it meets its container); the shipped skill only partly.
- Closed 2026-11-03 by the shipped skill: `elevation.md`, "Nested surfaces step apart" (an edge only where a nested surface meets its container), written for g05.
