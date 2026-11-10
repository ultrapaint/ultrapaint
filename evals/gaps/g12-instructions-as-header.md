---
id: g12
title: Instructions as the empty state's header
kind: missed
status: wontfix
found: 2026-11-03
source: the new chat's starters, editor redesign (branch redesign)
skill: [SKILL.md]
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
- Decision of 2026-11-03 (`decisions/recall-redesign-1`): no rule: the shipped skill caught it 2/2 with an independent reviewer per section, so what missed it was how the redesign was run (p02, p06).
- `recall-closing-check-1`: 2026-11-04, caught: shipped 2/2, closing-check 2/2 (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 2/2, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, caught: shipped@opus 2/2, shipped@gpt-6.1-sol 2/2, shipped@cursor:grok-4.7-high 2/2, shipped@cursor:composer-2.5 0/2 (+2 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 1/2 (+1 partly), shipped+outline 1/2 (+1 partly) (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 2/2, content-single 2/2, copy-outline 2/2 (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 1/2 (+1 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
