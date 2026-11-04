---
id: g04
title: A hint shown when it says nothing
kind: missing
status: done
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [references/restraint.md]
sections: [components-panel]
---

**What happened.** The Components panel always showed "Inserts into …" at its top, even with
nothing selected, when it only named the default target.

**The skill now.** `restraint.md` cuts what repeats its neighbour. It says nothing about context
that depends on state.

**Proposed.** Context that depends on a selection or a mode appears only in that state, beside
the action it affects (here, a footer shown with a selection).

**Test.** Panels whose action depends on a selection, drawn in both states.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 0/2 (+2 partly), redesign-gaps 2/2 (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): the candidate's rule took it from 0/2 to 2/2 (partly by construction).
- Closed 2026-11-03 by the shipped skill: `restraint.md`, "Context shows in its state".
- `recall-closing-check-1`: 2026-11-04, caught: shipped 2/2, closing-check 2/2 (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 1/1, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, caught: shipped@opus 1/1, shipped@gpt-6.1-sol 2/2, shipped@cursor:grok-4.7-high 0/2 (+1 partly), shipped@cursor:composer-2.5 0/2 (+2 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
