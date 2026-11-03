---
id: g11
title: Ten equal choices in an empty state
kind: missing
status: open
found: 2026-11-03
source: the new chat's starters, editor redesign (branch redesign)
skill: [references/states.md, references/hierarchy.md]
sections: [chat-starters]
---

**Setup.** The Agents panel's empty thread. The prompts predate the redesign; the redesign pass restyled them (no accordion, icon tiles or descriptions, so all ten choices on screen at once) and lengthened the intro. Neither it nor the lead's review questioned the words or the choices. The person asked for a judgement; the lead scored it 5/10. This finding came from a rule the skill has.

**What happened.** Nine prompts and an import, all set the same, in three labelled groups and a
fourth group of one. On a squint, nothing leads. This screen opens with every new chat, so a
daily user scrolls past it every time.

**The skill now.**
- `states.md`: an empty state comes "with one action that fills it".
- `hierarchy.md`: the squint test, and one primary action per screen.
- Both were missed. Neither says how many suggestions a list can hold, and chat panels
  conventionally show several starters, which reads as an exception to "one action".

**Proposed.**
- In `states.md`: "Suggestions in an empty state: three or four, chosen for the moment. More
  belong in search or a command."
- In `hierarchy.md`: "Rows of equal weight are a menu, not a hierarchy. When one choice is the
  likely one, it leads."

**Test.** Empty chat, search and dashboard states: count the choices shown, and run the squint
check.

**Result.**
