---
id: g14
title: An action of another kind in a list, in a group of one
kind: missing
status: done
found: 2026-11-03
source: the new chat's starters, editor redesign (branch redesign)
skill: [SKILL.md, references/components.md]
sections: [chat-starters]
---

**Setup.** The Agents panel's empty thread. The prompts predate the redesign; the redesign pass restyled them (no accordion, icon tiles or descriptions, so all ten choices on screen at once) and lengthened the intro. Neither it nor the lead's review questioned the words or the choices. The person asked for a judgement; the lead scored it 5/10. This finding came from a rule the skill has.

**What happened.** Rows that write a prompt into the composer sat beside "Import a .fig file…",
which opens a file picker. It had a group of its own whose label, "From Figma", repeats the row.

**The skill now.** `restraint.md`: "A heading over a group its content already names: Remove
it." This was missed. Nothing says a list holds one kind of item.

**Proposed.** In `restraint.md` or `components.md`: "A list holds one kind of item, doing one
kind of thing. An item that does something else goes where that kind of thing lives (an import
goes in the attach menu)."

**Test.** Lists of suggestions with a stray action: whether it is moved, or kept in a group of
its own.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 1/2 (+1 partly), redesign-gaps 2/2 (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): the candidate's rule took it from 1/2 to 2/2 (partly by construction).
- Closed 2026-11-03 by the shipped skill: `restraint.md`, "A list holds one kind of item".
- `recall-closing-check-1`: 2026-11-04, caught: shipped 2/2, closing-check 2/2 (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 2/2, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, caught: shipped@opus 2/2, shipped@gpt-6.1-sol 2/2, shipped@cursor:grok-4.7-high 2/2, shipped@cursor:composer-2.5 2/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 2/2, shipped+outline 2/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 2/2, content-single 2/2, copy-outline 2/2 (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- `ep-1`: 2026-11-10, caught: review-table@opus+untold 2/2, review-table@opus+told 2/2, review-table@gpt-6.1-sol+untold 2/2, review-table@gpt-6.1-sol+told 2/2 (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
- `rt-2`: 2026-11-11, caught: shipped 3/3, review-table 3/3, review-inventory 3/3 (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/rt-2/report.md)
