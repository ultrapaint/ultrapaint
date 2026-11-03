---
id: g05
title: Nested surfaces too close in tone
kind: missing
status: testing
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [references/elevation.md]
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
