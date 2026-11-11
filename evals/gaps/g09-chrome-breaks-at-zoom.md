---
id: g09
title: Chrome attached to a canvas object breaks at zoom
kind: missing
status: wontfix
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [SKILL.md]
sections: [element-toolbar]
---

**What happened.** The selected element's toolbar (its name and its actions), attached to the
selection:
- covered small elements when zoomed out;
- drifted off-screen when zoomed in.

**The fix used** (branch `redesign`, `a647e13`):
- A name tag with one action stays attached, capped to the element's width, and shrinks below
  a threshold.
- The element's other controls dock in a fixed bar above the tools, as do a page's and those of
  several elements.

**The skill now.** No pattern under `patterns/` covers a canvas or chrome that follows an
object.

**Proposed.** A canvas-tools pattern for:
- what stays attached to an object;
- what docks;
- how attached chrome behaves at both zoom extremes.

**Test.** Editor-like pieces with a selection, drawn at three zoom levels.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 2/2, redesign-gaps 2/2 (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): the shipped skill caught it 2/2 with an independent reviewer per section: missed through how the redesign was run (P2, P4), not for want of a rule.
- Decision of 2026-11-03 (`decisions/recall-redesign-1`): no pattern: the shipped skill caught it 2/2 with an independent reviewer per section, so what missed it was how the redesign was run (p02, p04). The candidate's canvas-tools pattern was dropped.
- `held-out-1`: 2026-11-04, caught: shipped 1/2 (+1 partly), held-out-themes 2/2, held-out-plain 1/2 (+1 partly) (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, caught: shipped@opus 1/2 (+1 partly), shipped@gpt-6.1-sol 2/2, shipped@cursor:grok-4.7-high 2/2, shipped@cursor:composer-2.5 2/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 2/2, shipped+outline 0/2 (+2 partly) (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- `ep-1`: 2026-11-10, caught: review-table@opus+untold 1/2 (+1 partly), review-table@opus+told 1/2 (+1 partly), review-table@gpt-6.1-sol+untold 1/2 (+1 partly), review-table@gpt-6.1-sol+told 1/2 (+1 partly) (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
- `rt-2`: 2026-11-11, caught: shipped 1/3 (+2 partly), review-table 0/3 (+3 partly), review-inventory 0/3 (+3 partly) (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/rt-2/report.md)
