---
id: g35
title: One relationship at two distances
kind: missed
status: testing
found: 2026-11-04
source: the Layers panel, editor redesign at f608871 (held-out finding layers-18, rated real)
skill: [references/spacing.md]
sections: [layers]
---

**What happened.** The gap after the chevron is gap-1.5 (6px) on PageRow but gap-1 (4px) on LayerRow, giving the same relationship two distances.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 0/2. The person rated it real
(`decisions/held-out-rest`, layers-18). Theme: spacing.

**The skill now.** `spacing.md`: "Every gap and padding is a step of its spacing scale, and the same relationship is always the same distance"; "Borderless text and icon buttons need more, around `16–24px`". The table checks for pixel numbers in place of tokens and groups closer than 3×. It doesn't check a gap that is a token but off the scale's steps, one relationship given two distances, rows stacked with no gap, a list ending on a rule, or a panel scrolling in two parts.

**Proposed.** In `spacing.md`'s table: "One relationship at two distances (the gap after a chevron, a dialog's padding against DESIGN.md) → one step"; "Rows with fills stacked with no gap → the scale's smallest step between them"; "The last row of a scroller flush on a rule → the list's padding below it"; "Two scroll regions in one panel → one".

**Test.** Recall on `layers`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 1/2, held-out-themes 1/2, held-out-plain 1/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): no wording caught it more often than the shipped skill (1/2 in every version). Its row ships for g36, which it closed; this one is for `pnpm evals measure` to check instead.
