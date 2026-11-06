---
id: g13
title: Items of one list in different forms
kind: missing
status: wontfix
found: 2026-11-03
source: the new chat's starters, editor redesign (branch redesign)
skill: [references/usability.md, references/content/interface.md]
sections: [chat-starters]
---

**Setup.** The Agents panel's empty thread. The prompts predate the redesign; the redesign pass restyled them (no accordion, icon tiles or descriptions, so all ten choices on screen at once) and lengthened the intro. Neither it nor the lead's review questioned the words or the choices. The person asked for a judgement; the lead scored it 5/10. This finding came from the lead's judgement.

**What happened.** Among sentences, one row was command syntax: `/implement /ask-card`. The
second slash is the page's URL, so the row read like a bug. The group labels didn't share a
form either: "Tidy and polish", "Generate designs", "Implement in code", "From Figma".

**The skill now.**
- `usability.md` ("One thing, one name, one place") covers one action across screens, not the
  items within one list.
- `content.md` has no rule about parallel form.

**Proposed.** In `content.md`: "Items of one list share one form: all sentences, all verbs, or
all nouns. A code value (a route, a command) follows the words, muted and in the code face; it
isn't the item."

**Test.** Lists that mix code values into prose: whether the code is kept apart from the item.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 2/2, redesign-gaps 2/2 (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): the shipped skill caught it 2/2 with an independent reviewer per section: missed through how the redesign was run (P2, P6), not for want of a rule.
- Decision of 2026-11-03 (`decisions/recall-redesign-1`): no rule: the shipped skill caught it 2/2 with an independent reviewer per section, so what missed it was how the redesign was run (p02, p06). The candidate's rule was dropped.
- `recall-closing-check-1`: 2026-11-04, caught: shipped 2/2, closing-check 1/2 (+1 partly) (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 2/2, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, caught: shipped@opus 2/2, shipped@gpt-6.1-sol 1/2 (+1 partly), shipped@cursor:grok-4.7-high 0/2 (+2 partly), shipped@cursor:composer-2.5 0/2 (+2 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 0/2 (+2 partly), shipped+outline 1/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
