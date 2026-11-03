---
id: g14
title: An action of another kind in a list, in a group of one
kind: missing
status: done
found: 2026-11-03
source: the new chat's starters, editor redesign (branch redesign)
skill: [references/restraint.md, references/components.md]
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
