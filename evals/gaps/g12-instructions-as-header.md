---
id: g12
title: Instructions as the empty state's header
kind: missed
status: testing
found: 2026-11-03
source: the new chat's starters, editor redesign (branch redesign)
skill: [references/restraint.md]
sections: [chat-starters]
---

**Setup.** The Agents panel's empty thread. The prompts predate the redesign; the redesign pass restyled them (no accordion, icon tiles or descriptions, so all ten choices on screen at once) and lengthened the intro. Neither it nor the lead's review questioned the words or the choices. The person asked for a judgement; the lead scored it 5/10. This finding came from a rule the skill has.

**What happened.** "What's next?" (in a chat where nothing has happened yet) over two
sentences on how to use the panel ("Select something on the canvas, then pick a start or write
your own"), the longest text on the screen. The redesign made it longer.

**The skill now.** `restraint.md`:
- "A sentence explaining how to use a control: Remove it."
- "An intro, eyebrow or subtitle on a screen whose purpose is plain: Remove it."

**Proposed.** No new rule. Run restraint's table on copy kept from before, not only on new copy
(see P6).

**Test.** Restyle tasks on screens with legacy copy: count instructional sentences left in.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 2/2, redesign-gaps 2/2 (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): the shipped skill caught it 2/2 with an independent reviewer per section: missed through how the redesign was run (P2, P6).
