---
id: p04
title: Whole screens reviewed instead of sections
kind: process
status: done
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [SKILL.md]
sections: [left-card-raised, tools-bar]
---

**What happened.** The lead reviewed whole screens at 1600×1000 and called them good. The
person found G1–G3 and G5–G8 by looking at one section at a time. This matches the lab's
earlier finding that sections compared one at a time catch problems that whole screens hide.

**Proposed.** Review with crops of each section, at 2×.

**Test.** See G6.

It applied to the new chat's starters too.

**Result.**

- `recall-redesign-1`: 2026-11-03, its sections' gaps caught: shipped 0/6 (+2 partly), redesign-gaps 2/6 (+3 partly) (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- `recall-closing-check-1`: 2026-11-04, its sections' gaps caught: shipped 1/6 (+2 partly), closing-check 2/6 (+2 partly) (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked): shipped in step 7 of `SKILL.md`: each section is reviewed from a crop at 2×, dark and light. Same evidence as p02, since every recall reviewer worked from 2× crops.
- `held-out-1`: 2026-11-04, its sections' gaps caught: shipped 2/6 (+2 partly), held-out-themes 2/6 (+1 partly), held-out-plain 2/6 (+1 partly) (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, its sections' gaps caught: shipped@opus 2/6 (+2 partly), shipped@gpt-6.1-sol 2/6 (+2 partly), shipped@cursor:grok-4.7-high 0/6 (+4 partly), shipped@cursor:composer-2.5 0/6 (+6 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, its sections' gaps caught: shipped 2/6 (+2 partly), shipped+outline 0/6 (+1 partly) (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `rb-recall-before`: 2026-11-08, its sections' gaps caught: shipped 0/6 (+2 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, its sections' gaps caught: shipped 0/4 (+1 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, its sections' gaps caught: rb-check 0/6 (+5 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
