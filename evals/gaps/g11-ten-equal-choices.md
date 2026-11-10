---
id: g11
title: Ten equal choices in an empty state
kind: missing
status: done
found: 2026-11-03
source: the new chat's starters, editor redesign (branch redesign)
skill: [references/states.md, SKILL.md]
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

- `recall-redesign-1`: 2026-11-03, caught: shipped 0/2 (+1 partly), redesign-gaps 2/2 (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): the candidate's rules took it from 0/2 to 2/2 (partly by construction).
- Closed 2026-11-03 by the shipped skill: `hierarchy.md` (rows of equal weight are a menu) and `states.md` (three or four suggestions in an empty state).
- `recall-closing-check-1`: 2026-11-04, caught: shipped 2/2, closing-check 2/2 (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 2/2, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, caught: shipped@opus 2/2, shipped@gpt-6.1-sol 2/2, shipped@cursor:grok-4.7-high 2/2, shipped@cursor:composer-2.5 2/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 2/2, shipped+outline 2/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 2/2, content-single 2/2, copy-outline 2/2 (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
