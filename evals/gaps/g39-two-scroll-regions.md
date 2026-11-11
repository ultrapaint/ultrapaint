---
id: g39
title: One panel scrolling in two regions
kind: missing
status: wontfix
found: 2026-11-04
source: the Changes panel, editor redesign at f608871 (held-out finding changes-29, rated real)
skill: [SKILL.md]
sections: [changes]
---

**What happened.** The file list (`max-h-[45%] overflow-auto`) and the history (`flex-1 overflow-auto border-t`) scroll separately, split by a hairline plus spacing, while other groups are split by space alone.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 1/2. The person rated it real
(`decisions/held-out-rest`, changes-29). Theme: spacing.

**The skill now.** `spacing.md`: "Every gap and padding is a step of its spacing scale, and the same relationship is always the same distance"; "Borderless text and icon buttons need more, around `16–24px`". The table checks for pixel numbers in place of tokens and groups closer than 3×. It doesn't check a gap that is a token but off the scale's steps, one relationship given two distances, rows stacked with no gap, a list ending on a rule, or a panel scrolling in two parts.

**Proposed.** In `spacing.md`'s table: "One relationship at two distances (the gap after a chevron, a dialog's padding against DESIGN.md) → one step"; "Rows with fills stacked with no gap → the scale's smallest step between them"; "The last row of a scroller flush on a rule → the list's padding below it"; "Two scroll regions in one panel → one".

**Test.** Recall on `changes`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 2/2, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): no new wording: the shipped skill caught it 2/2 with a fresh reviewer per section, so what missed it was how the redesign was run (p02), now step 7 of SKILL.md.
- `models-1`: 2026-11-04, caught: shipped@opus 2/2, shipped@gpt-6.1-sol 1/2 (+1 partly), shipped@cursor:grok-4.7-high 2/2, shipped@cursor:composer-2.5 1/2 (+1 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 0/2 (+1 partly), shipped+outline 1/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 2/2, content-single 1/2, copy-outline 0/2 (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 1/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- `rt-2`: 2026-11-11, caught: shipped 1/3, review-table 3/3, review-inventory 3/3 (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/rt-2/report.md)
- `ep-1`: 2026-11-11, caught: review-table@opus+untold 1/2 (+1 partly), review-table@opus+told 2/2, review-table@gpt-6.1-sol+untold 0/2 (+2 partly), review-table@gpt-6.1-sol+told 2/2 (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
