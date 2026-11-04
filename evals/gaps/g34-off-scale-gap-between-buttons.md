---
id: g34
title: An off-scale gap between borderless buttons
kind: missed
status: testing
found: 2026-11-04
source: the Layers panel, editor redesign at f608871 (held-out finding layers-13, rated real)
skill: [references/spacing.md]
sections: [layers]
---

**What happened.** The two header icon buttons are separated by gap-0.5 (2px), off the 4px scale and too tight for borderless buttons.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 0/2. The person rated it real
(`decisions/held-out-rest`, layers-13). Theme: spacing.

**The skill now.** `spacing.md`: "Every gap and padding is a step of its spacing scale, and the same relationship is always the same distance"; "Borderless text and icon buttons need more, around `16–24px`". The table checks for pixel numbers in place of tokens and groups closer than 3×. It doesn't check a gap that is a token but off the scale's steps, one relationship given two distances, rows stacked with no gap, a list ending on a rule, or a panel scrolling in two parts.

**Proposed.** In `spacing.md`'s table: "One relationship at two distances (the gap after a chevron, a dialog's padding against DESIGN.md) → one step"; "Rows with fills stacked with no gap → the scale's smallest step between them"; "The last row of a scroller flush on a rule → the list's padding below it"; "Two scroll regions in one panel → one".

**Test.** Recall on `layers`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 0/2 (+1 partly), held-out-themes 0/2, held-out-plain 0/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): no wording caught it more often than the shipped skill (`held-out-themes` and `held-out-plain` alike); its row was not shipped. Spacing ones (g34, g35, g37) are for `pnpm evals measure` to check instead.
- `models-1`: 2026-11-04, caught: shipped@opus 0/2 (+1 partly), shipped@gpt-6.1-sol 0/2, shipped@cursor:grok-4.7-high 2/2, shipped@cursor:composer-2.5 0/2 (+1 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
