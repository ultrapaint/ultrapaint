---
id: g15
title: Suggestions placed away from where they act
kind: missing
status: done
found: 2026-11-03
source: the new chat's starters, editor redesign (branch redesign)
skill: [references/spacing.md, references/usability.md, references/layout.md]
sections: [chat-starters]
---

**Setup.** The Agents panel's empty thread. The prompts predate the redesign; the redesign pass restyled them (no accordion, icon tiles or descriptions, so all ten choices on screen at once) and lengthened the intro. Neither it nor the lead's review questioned the words or the choices. The person asked for a judgement; the lead scored it 5/10. This finding came from the lead's judgement.

**What happened.** The starters fill the composer at the bottom of the panel, but they sit at
its top with half a screen of space between. The click and its effect are far apart.

**The skill now.**
- `spacing.md` ("Proximity shows the grouping") covers the gaps between groups.
- `usability.md` puts what a decision needs beside it.
- Neither says a control sits next to what it changes.

**Proposed.** In `layout.md`: "A control sits next to what it changes: suggestions that fill a
field sit against the field (chat starters just above the composer), and filters sit above the
list they filter."

**Test.** Chat and search empty states: the distance from the suggestions to the field they
fill.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 0/2, redesign-gaps 2/2 (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): the candidate's rule took it from 0/2 to 2/2 (partly by construction).
- Closed 2026-11-03 by the shipped skill: `layout.md`, "A control sits next to what it changes".
- `recall-closing-check-1`: 2026-11-04, caught: shipped 2/2, closing-check 2/2 (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 2/2, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, caught: shipped@opus 2/2, shipped@gpt-6.1-sol 2/2, shipped@cursor:grok-4.7-high 2/2, shipped@cursor:composer-2.5 1/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
