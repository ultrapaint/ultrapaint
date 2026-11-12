---
id: g65
title: Comparison values heavier than their row labels
kind: missed
status: done
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [SKILL.md, references/pages/landing.md]
sections: []
---

**What happened.** On `untitled-pricing` the values of the comparison (10, 20GB, Unlimited) were set medium or semibold in the foreground, as heavy as or heavier than the row labels, so the table read flat. The per-run judge found it in both runs; the pairwise judge named it in run 1. Pictures: `gaps/g65/`.

**The skill now.** `SKILL.md`, Type: "Names in a list take the label style, heavier than their metadata." `landing.md`'s Comparison line says nothing of weight.

**Proposed.** `landing.md`, Comparison: "row labels in the label style; values regular", and a Check row: "Values as heavy as their row labels → Values `400`".

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse.

**Result.**

- `pp-in`, `held-pp`: 2026-11-11, Opus in Claude Code designs and judges. In-sample: shipped (`out-land`) against `candidates/public-pages` (`pp-in`) on alignui-waitlist, hcare-landing and untitled-pricing, 3 runs each. Held-out: `held-ship` against `held-pp` on six `held-*` pages from facts briefs, 2 runs each. Counts are the per-run judge's gap lists (`runs/<round>/gaps.json`); pairwise in both orders, a winner that changed with the order counted as a tie (`runs/out-land-vs-pp-in/`, `runs/held-ship-vs-held-pp/`). untitled-pricing: shipped 3/3 ("Table values as heavy as their row labels"), candidate 0/3; a pairwise reason names it (run 1). Held-out: neither version raised it on held-attio-pricing.
- Accepted (decisions `public-pages-ship` and `lab-direction-nov12`, 11–12 November): `landing.md`'s Comparison line says labels in the label style and values regular, with a Check row "Comparison values as heavy as their row labels → Values `400`".
