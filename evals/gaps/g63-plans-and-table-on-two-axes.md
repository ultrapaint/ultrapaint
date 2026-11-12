---
id: g63
title: Plan cards and the comparison under them on two axes
kind: missing
status: wontfix
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [references/pages/landing.md]
sections: []
---

**What happened.** On `untitled-pricing` run 2 the comparison's values were centred in their columns under plan cards whose contents were set left, so card and column did not share an edge; the no-skill run put each value under its plan's name, and both pairwise judges counted it for craft. The person, asked which to keep: "Keep centred": the table's columns stay centred and the cards follow them. Pictures: `gaps/g63/`.

**The skill now.** `references/pages/landing.md`, Comparison: "labels left, plan columns equal and centred". Nothing says how plan cards over the table align.

**Proposed.** Plans over a comparison share its columns: each card the width of its plan's column, its name, price and button centred on the column's axis, as the values under it are.

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse. Held-out: `held-attio-pricing`.

**Result.**

- `pp-in`, `held-pp`: 2026-11-11, Opus in Claude Code designs and judges. In-sample: shipped (`out-land`) against `candidates/public-pages` (`pp-in`) on alignui-waitlist, hcare-landing and untitled-pricing, 3 runs each. Held-out: `held-ship` against `held-pp` on six `held-*` pages from facts briefs, 2 runs each. Counts are the per-run judge's gap lists (`runs/<round>/gaps.json`); pairwise in both orders, a winner that changed with the order counted as a tie (`runs/out-land-vs-pp-in/`, `runs/held-ship-vs-held-pp/`). untitled-pricing: shipped 1/3 ("Column values centred under left-aligned cards"), candidate 0/3. held-attio-pricing: candidate 2/2 "Plan cards forced into the comparison's columns" (run 1's pairwise reason: narrow cards "until nearly every feature line wraps"), shipped 0/2. Reading: sharing the table's columns squeezes cards that carry feature lists, so bound the line to cards without one, or drop it.
- Set aside 12 November (`lab-direction-nov12`): a recipe from one reference page; the person rated the line wrong.
- 12 November: set aside under ADR 0082. It is one reference's recipe, and the skill is no longer measured against the page a rule came from; a fault of this kind that recurs on fresh briefs opens a gap of its own.
