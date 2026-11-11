---
id: g45
title: A settings row's select drawn as a box
kind: missed
status: wontfix
found: 2026-11-04
source: the Settings dialog, editor redesign at f608871 (held-out finding settings-12, rated real)
skill: [references/surfaces.md, references/components.md, references/typography.md]
sections: [settings]
---

**What happened.** The Theme and Send-messages selects are drawn as fixed-width filled boxes pinned right. In a settings row, a select should be its value text and a chevron, so the boxes add heavy shapes that look like typing fields.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 2/2. The person rated it real
(`decisions/held-out-rest`, settings-12). Theme: surfaces.

**The skill now.** `elevation.md`'s four levels say an overlay is above the page; nothing checks a dialog's panes against the dimmed page. `components.md`: "A select inside a row or a sentence is its text and a small chevron" (table: "An outlined select inside a table row or a sentence"). `typography.md`: "A placeholder is muted and shows an example." Nothing on a line drawn through a selection.

**Proposed.** In `elevation.md`'s table: "A dialog's pane darker than what it covers, or its two panes one tone → the content pane on the overlay surface, a step above". In `components.md`'s table: "A settings row's select drawn as a filled box → its value and a chevron". In `typography.md`'s table: "A placeholder showing a real value (a default, a fallback) → an example, or the value itself set". In `borders.md`'s table: "A guide or rule drawn across a selected row's fill → it stops at the fill".

**Test.** Recall on `settings`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `models-smoke`: 2026-11-04, caught: shipped@gpt-6.1-sol 1/1, shipped@cursor:gemini-4-argon 1/1 (reviewed by gpt-6.1-sol, cursor:gemini-4-argon, judged by opus, effort high; runs/models-smoke/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 2/2, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): no new wording: the shipped skill caught it 2/2 with a fresh reviewer per section, so what missed it was how the redesign was run (p02), now step 7 of SKILL.md.
- `models-1`: 2026-11-04, caught: shipped@opus 2/2, shipped@gpt-6.1-sol 2/2, shipped@cursor:grok-4.7-high 2/2, shipped@cursor:composer-2.5 2/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 2/2, shipped+outline 0/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 2/2, content-single 2/2, copy-outline 2/2 (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- `ep-1`: 2026-11-10, caught: review-table@opus+untold 0/2 (+2 partly), review-table@opus+told 0/2 (+2 partly), review-table@gpt-6.1-sol+untold 0/2 (+1 partly), review-table@gpt-6.1-sol+told 0/2 (+2 partly) (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
