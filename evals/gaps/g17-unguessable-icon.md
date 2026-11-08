---
id: g17
title: An icon alone for an action nobody would guess
kind: missed
status: wontfix
found: 2026-11-03
source: the new chat's starters, editor redesign (branch redesign)
skill: [references/iconography.md]
sections: [chat-starters]
---

**Setup.** The Agents panel's empty thread. The prompts predate the redesign; the redesign pass restyled them (no accordion, icon tiles or descriptions, so all ten choices on screen at once) and lengthened the intro. Neither it nor the lead's review questioned the words or the choices. The person asked for a judgement; the lead scored it 5/10. This finding came from a rule the skill has.

**What happened.** The eye in the thread's header means "Follow on the canvas". An eye reads
as show or hide.

**The skill now.** `iconography.md` ("A label by default"): "An icon stands alone only for
actions everyone recognises", followed by a list that has no eye for follow.

**Proposed.** No new rule. Iconography's table should catch it: "An icon-only button for an
action outside the list: give it a label". Today the table checks only for a missing tooltip.

**Test.** Toolbars with domain actions: icon-only buttons outside the list.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 2/2, redesign-gaps 1/2 (+1 partly) (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): no gain: the shipped skill caught it 2/2; the new table row didn't help.
- Decision of 2026-11-03 (`decisions/recall-redesign-1`): no new row: the shipped skill caught it 2/2, and the candidate's iconography row added nothing. It was dropped.
- `recall-closing-check-1`: 2026-11-04, caught: shipped 1/2 (+1 partly), closing-check 1/2 (+1 partly) (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 1/2 (+1 partly), held-out-themes 0/2 (+2 partly), held-out-plain 1/2 (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, caught: shipped@opus 1/2 (+1 partly), shipped@gpt-6.1-sol 1/2 (+1 partly), shipped@cursor:grok-4.7-high 2/2, shipped@cursor:composer-2.5 0/2 (+1 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 1/2 (+1 partly), shipped+outline 2/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 1/2 (+1 partly), content-single 1/2 (+1 partly), copy-outline 1/2 (+1 partly) (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 0/2 (+2 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 1/2 (+1 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
