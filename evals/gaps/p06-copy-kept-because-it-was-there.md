---
id: p06
title: Copy kept because it was there
kind: process
status: wontfix
found: 2026-11-03
source: the new chat's starters, editor redesign (branch redesign)
skill: [SKILL.md, references/words/interface.md]
sections: [chat-starters]
---

**Setup.** The Agents panel's empty thread. The prompts predate the redesign; the redesign pass restyled them (no accordion, icon tiles or descriptions, so all ten choices on screen at once) and lengthened the intro. Neither it nor the lead's review questioned the words or the choices. The person asked for a judgement; the lead scored it 5/10.

**What happened.** The brief asked to redesign "each text". The pass reworked the look and kept
every prompt, the intro and the group names, apart from typographic fixes. It never asked
whether each prompt could act in the state the panel opens in (G10). The review looked at the
pixels, not the words.

**Proposed.** For each surface, a content pass that reads every text and action against every
state the surface is in: "is this true and actionable now?" Restraint's and content's tables
apply to inherited copy as much as to new copy.

**Test.** Restyle tasks on legacy screens: the share of the legacy copy's problems fixed.

**Result.**

- `recall-redesign-1`: 2026-11-03, its sections' gaps caught: shipped 11/16 (+2 partly), redesign-gaps 15/16 (+1 partly) (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- `recall-closing-check-1`: 2026-11-04, its sections' gaps caught: shipped 15/16 (+1 partly), closing-check 14/16 (+2 partly) (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked): not shipped: in `recall-closing-check-1`, reading every text against every state in step 6 gave 14/16 against 15/16 without it.
- `held-out-1`: 2026-11-04, its sections' gaps caught: shipped 15/16 (+1 partly), held-out-themes 14/16 (+2 partly), held-out-plain 15/16 (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, its sections' gaps caught: shipped@opus 15/16 (+1 partly), shipped@gpt-6.1-sol 14/16 (+2 partly), shipped@cursor:grok-4.7-high 13/16 (+2 partly), shipped@cursor:composer-2.5 9/16 (+5 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, its sections' gaps caught: shipped 12/16 (+4 partly), shipped+outline 12/16 (+1 partly) (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, its sections' gaps caught: shipped 14/16 (+2 partly), content-single 15/16 (+1 partly), copy-outline 15/16 (+1 partly) (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, its sections' gaps caught: shipped 14/16 (+2 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, its sections' gaps caught: shipped 10/16 (+5 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, its sections' gaps caught: rb-check 11/16 (+5 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- `rt-2`: 2026-11-11, its sections' gaps caught: shipped 19/24 (+3 partly), review-table 21/24 (+3 partly), review-inventory 21/24 (+2 partly) (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/rt-2/report.md)
- `ep-1`: 2026-11-11, its sections' gaps caught: review-table@opus+untold 12/16 (+2 partly), review-table@opus+told 13/16 (+3 partly), review-table@gpt-6.1-sol+untold 5/16 (+7 partly), review-table@gpt-6.1-sol+told 12/16 (+4 partly) (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
