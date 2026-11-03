---
id: p07
title: One rule's fix broke another, unchecked
kind: process
status: open
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
