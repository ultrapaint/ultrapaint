---
id: g62
title: The recommended plan marked weakly, or many times
kind: missing
status: testing
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [references/pages/landing.md]
sections: []
---

**What happened.** On `untitled-pricing`, run 1 set Growth apart by its filled button and a small badge only; run 2 by a tinted card, a badge, a filled button, a band through the table cut off from its card by a gap, and filled checks in that column alone. The no-skill run 2 drew one tinted column unbroken from the card to the table's last row; both pairwise judges read it as the plan to pick. The per-run judge found "Recommended plan marked weakly and many times" in both runs. The person, asked how the plan should stand out: "One column, card to last row". Pictures: `gaps/g62/`.

**The skill now.** `references/pages/landing.md`, Pricing: "The recommended plan is marked once: a tab on its top edge, the only dark card or the only filled button." Comparison: "The recommended column is one band through every group, its checks inverted". The first allows a mark too weak to read; the second adds two more.

**Proposed.** The recommended plan is one tinted column, unbroken from its card through the table's last row; its button is the only filled one and a tag inside its card the only word for it. No second band, no checks of another style. A Check row: "A recommended plan marked by a button or a tag alone, or by a card and a separate band → One column, card to last row".

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse. Held-out: `held-attio-pricing`.

**Result.**

- `pp-in`, `held-pp`: 2026-11-11, Opus in Claude Code designs and judges. In-sample: shipped (`out-land`) against `candidates/public-pages` (`pp-in`) on alignui-waitlist, hcare-landing and untitled-pricing, 3 runs each. Held-out: `held-ship` against `held-pp` on six `held-*` pages from facts briefs, 2 runs each. Counts are the per-run judge's gap lists (`runs/<round>/gaps.json`); pairwise in both orders, a winner that changed with the order counted as a tie (`runs/out-land-vs-pp-in/`, `runs/held-ship-vs-held-pp/`). untitled-pricing: shipped 3/3 ("marked weakly or many times"); candidate 3/3 in a new form, "Recommended plan dissolved into a pale tinted column". Pairwise, the candidate won all 3 pricing runs, hierarchy 3–0, and the reasons name the band through the Growth column. held-attio-pricing: shipped 2/2 ("marked many ways, with mixed check styles", and the filled button on Free); candidate 2/2 "tint runs through empty space": in run 1 the column ran past its card, through the gap and the "Compare plans" heading, into the table, while in run 2 the judge read it as the plan. Shipped won both held-out pricing pairs, on the fold (the candidate put a landing hero before the plans), not on the mark. Reading: the one column wins where the table sits directly under the cards, so bound it to that layout and give its tint a floor that reads.
- Set aside 12 November (`lab-direction-nov12`): a recipe from one reference page. The person asked why the tint runs below the cards and why the plan's details repeat in the table.
