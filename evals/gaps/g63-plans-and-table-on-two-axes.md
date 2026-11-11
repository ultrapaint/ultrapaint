---
id: g63
title: Plan cards and the comparison under them on two axes
kind: missing
status: open
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
