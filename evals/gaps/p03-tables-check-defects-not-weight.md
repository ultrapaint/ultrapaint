---
id: p03
title: The final tables check defects, not weight
kind: process
status: wontfix
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [SKILL.md]
sections: [components-panel, chat-starters]
---

**What happened.** Each "Before you finish" table lists local defects. None asks whether the
whole section's ranking is right. `hierarchy.md` has the squint test, but the closing check in
`SKILL.md` step 6 doesn't require it for each section.

**Proposed.** End step 6 with a squint for each section: name its three heaviest things. They
must be what the section is for.

**Test.** Count the hierarchy findings caught with and without it.

**Result.**

- `recall-redesign-1`: 2026-11-03, its sections' gaps caught: shipped 13/24 (+5 partly), redesign-gaps 21/24 (+3 partly) (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- `recall-closing-check-1`: 2026-11-04, its sections' gaps caught: shipped 21/24 (+3 partly), closing-check 20/24 (+4 partly) (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked): not shipped: in `recall-closing-check-1`, a squint per section in step 6 gave 20/24 of its sections' gaps against 21/24 without it. The shipped rules already cover what it would catch.
- `held-out-1`: 2026-11-04, its sections' gaps caught: shipped 19/21 (+1 partly), held-out-themes 20/24 (+3 partly), held-out-plain 20/24 (+3 partly) (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, its sections' gaps caught: shipped@opus 19/21 (+1 partly), shipped@gpt-6.1-sol 17/24 (+3 partly), shipped@cursor:grok-4.7-high 15/24 (+6 partly), shipped@cursor:composer-2.5 11/24 (+10 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, its sections' gaps caught: shipped 18/24 (+4 partly), shipped+outline 14/24 (+3 partly) (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, its sections' gaps caught: shipped 20/24 (+3 partly), content-single 21/24 (+2 partly), copy-outline 21/24 (+2 partly) (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, its sections' gaps caught: shipped 17/24 (+6 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, its sections' gaps caught: shipped 13/24 (+9 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, its sections' gaps caught: rb-check 11/24 (+10 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- `rt-2`: 2026-11-11, its sections' gaps caught: shipped 24/36 (+7 partly), review-table 28/36 (+6 partly), review-inventory 30/36 (+2 partly) (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/rt-2/report.md)
- `ep-1`: 2026-11-11, its sections' gaps caught: review-table@opus+untold 14/24 (+8 partly), review-table@opus+told 19/24 (+5 partly), review-table@gpt-6.1-sol+untold 7/24 (+12 partly), review-table@gpt-6.1-sol+told 14/24 (+7 partly) (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
- `g02-2`: 2026-11-11, its sections' gaps caught: shipped 7/12 (+4 partly), g02-three-times 9/12 (+2 partly) (opus, effort high; runs/g02-2/report.md)
