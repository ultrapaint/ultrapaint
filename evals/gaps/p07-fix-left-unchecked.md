---
id: p07
title: One rule's fix broke another, unchecked
kind: process
status: wontfix
found: 2026-11-03
source: the new chat's starters, editor redesign (branch redesign)
skill: [SKILL.md, references/hierarchy.md]
sections: [chat-starters]
---

**Setup.** The Agents panel's empty thread. The prompts predate the redesign; the redesign pass restyled them (no accordion, icon tiles or descriptions, so all ten choices on screen at once) and lengthened the intro. Neither it nor the lead's review questioned the words or the choices. The person asked for a judgement; the lead scored it 5/10.

**What happened.** Restraint's cut (no icon tiles, no descriptions, no accordion) was right on
its own, but it put all ten choices on screen at once, and the hierarchy got worse (G11).
Each table was run once, so nothing checked the screen after the fix.

**Proposed.** After applying a table's fixes, run the squint test (`hierarchy.md`) again on the
section. A fix that removes structure re-weighs what remains.

**Test.** Restyle tasks: hierarchy findings before and after a second squint pass.

**Result.**

- `recall-redesign-1`: 2026-11-03, its sections' gaps caught: shipped 11/16 (+2 partly), redesign-gaps 15/16 (+1 partly) (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- `recall-closing-check-1`: 2026-11-04, its sections' gaps caught: shipped 15/16 (+1 partly), closing-check 14/16 (+2 partly) (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked): not shipped: in `recall-closing-check-1`, a second pass after a fix gave 14/16 against 15/16 without it.
- `held-out-1`: 2026-11-04, its sections' gaps caught: shipped 15/16 (+1 partly), held-out-themes 14/16 (+2 partly), held-out-plain 15/16 (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, its sections' gaps caught: shipped@opus 15/16 (+1 partly), shipped@gpt-6.1-sol 14/16 (+2 partly), shipped@cursor:grok-4.7-high 13/16 (+2 partly), shipped@cursor:composer-2.5 9/16 (+5 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
