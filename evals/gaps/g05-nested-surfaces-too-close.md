---
id: g05
title: Nested surfaces too close in tone
kind: missing
status: done
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [SKILL.md, references/surfaces.md]
sections: [left-card]
---

**What happened.** In the left card, the frame (project, canvas picker, rail) and the panel
inside it were nearly the same tone. The person asked for "more depth between the surfaces".

**The fix used.**
- The frame is a step darker (`rail`).
- The panel is raised inside it on `sidebar`, flush with the card's edges.
- The panel has a hairline and a 10px corner only where it meets the frame.
- The current rail item is raised the same way.

**The skill now.** `elevation.md` has four levels for page, sunken, raised and overlay. It says
nothing about a surface nested inside a floating one.

**Proposed.** A surface nested in another differs from it by at least one tone step (in dark,
about 0.045 oklch lightness). It is flush with its container's edges, and draws its edge only
where it meets its container.

**Test.** Two-level sidebars, in dark and light. Have a person pick between tone steps.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 0/2, redesign-gaps 0/2 (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): no wording caught it: before the fix there is no nested surface for the rule to apply to; the depth the person asked for is a call about the card's structure.
- 2026-11-03: the rule ships in `elevation.md` for g06, which it caught; g05 itself stays `testing` (0/2 in both versions).
- Decision of 2026-11-03 (`decisions/recall-redesign-1`): a rule worth trying, about what a card holding navigation and a panel separates by tone; to write and test with recall.
- `recall-g05-1`: 2026-11-04, caught: shipped 0/2, g05-card-depth 2/2 (claude-opus-5-5, effort high; runs/recall-g05-1/report.md)
- Closed 2026-11-04 by the shipped skill: `elevation.md`, "A card's chrome and content sit on two tones" and its row (the person's decision, after `recall-g05-1`).
- `held-out-1`: 2026-11-04, caught: shipped 2/2, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, caught: shipped@opus 2/2, shipped@gpt-6.1-sol 2/2, shipped@cursor:grok-4.7-high 2/2, shipped@cursor:composer-2.5 2/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 2/2, shipped+outline 0/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 1/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 0/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 1/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- `ep-1`: 2026-11-10, caught: review-table@opus+untold 0/2, review-table@opus+told 0/2, review-table@gpt-6.1-sol+untold 0/2, review-table@gpt-6.1-sol+told 2/2 (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
