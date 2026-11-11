---
id: g36
title: A dialog's padding off the design system
kind: missed
status: done
found: 2026-11-04
source: the Settings dialog, editor redesign at f608871 (held-out finding settings-3, rated real)
skill: [SKILL.md]
sections: [settings]
---

**What happened.** The dialog uses 24px padding for header, body and footer and a 56px header, where DESIGN.md gives dialogs 20px padding.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 0/2. The person rated it real
(`decisions/held-out-rest`, settings-3). Theme: spacing.

**The skill now.** `spacing.md`: "Every gap and padding is a step of its spacing scale, and the same relationship is always the same distance"; "Borderless text and icon buttons need more, around `16–24px`". The table checks for pixel numbers in place of tokens and groups closer than 3×. It doesn't check a gap that is a token but off the scale's steps, one relationship given two distances, rows stacked with no gap, a list ending on a rule, or a panel scrolling in two parts.

**Proposed.** In `spacing.md`'s table: "One relationship at two distances (the gap after a chevron, a dialog's padding against DESIGN.md) → one step"; "Rows with fills stacked with no gap → the scale's smallest step between them"; "The last row of a scroller flush on a rule → the list's padding below it"; "Two scroll regions in one panel → one".

**Test.** Recall on `settings`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `models-smoke`: 2026-11-04, caught: shipped@gpt-6.1-sol 0/1, shipped@cursor:gemini-4-argon 1/1 (reviewed by gpt-6.1-sol, cursor:gemini-4-argon, judged by opus, effort high; runs/models-smoke/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 1/2, held-out-themes 2/2, held-out-plain 0/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): closed by the row the candidate `held-out-themes` added to the check table, shipped with the gap's number in its commit. The same row in general words (`held-out-plain`) caught it less often or not at all; the example in the row is what the reviewer recognises.
- `models-1`: 2026-11-04, caught: shipped@opus 1/2, shipped@gpt-6.1-sol 0/2, shipped@cursor:grok-4.7-high 0/2, shipped@cursor:composer-2.5 2/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 1/2, shipped+outline 0/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 2/2, content-single 2/2, copy-outline 1/2 (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 1/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- `ep-1`: 2026-11-10, caught: review-table@opus+untold 0/2, review-table@opus+told 0/2 (+1 partly), review-table@gpt-6.1-sol+untold 0/2 (+1 partly), review-table@gpt-6.1-sol+told 1/2 (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
