---
id: g17
title: An icon alone for an action nobody would guess
kind: missed
status: testing
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
