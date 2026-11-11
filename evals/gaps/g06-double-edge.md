---
id: g06
title: An inset panel drawing a double edge
kind: missed
status: done
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [SKILL.md, references/surfaces.md]
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
- `recall-closing-check-1`: 2026-11-04, caught: shipped 1/2 (+1 partly), closing-check 2/2 (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 2/2, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, caught: shipped@opus 2/2, shipped@gpt-6.1-sol 0/2 (+2 partly), shipped@cursor:grok-4.7-high 0/2 (+2 partly), shipped@cursor:composer-2.5 0/2 (+2 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 0/2, shipped+outline 0/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 0/2 (+1 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 0/1 (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 0/2 (+2 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- `ep-1`: 2026-11-10, caught: review-table@opus+untold 1/2 (+1 partly), review-table@opus+told 1/2 (+1 partly), review-table@gpt-6.1-sol+untold 0/2, review-table@gpt-6.1-sol+told 0/2 (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
