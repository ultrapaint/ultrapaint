---
id: g66
title: A floating card that covers the product picture's content
kind: missing
status: testing
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [references/pages/landing.md, references/surfaces.md]
sections: []
---

**What happened.** On `hcare-landing` run 1 the "3,256 Total Patients" card lifted over the dashboard picture covers its pie and donut charts; in run 2 the cards cut tiles in half and the picture took the same shadow as the cards over it. The no-skill cards sat over empty corners of the frame. Craft went to no skill on this page in both runs; the per-run judge found it in both. Pictures: `gaps/g66/`.

**The skill now.** Nothing on cards laid over a product picture. `landing.md`: "One image per section may cross an edge." `surfaces.md`: a shadow belongs to a level.

**Proposed.** `landing.md`, By character, Technical: "A card lifted over the product picture covers empty space or the picture's edge, never a chart, a figure or half an element, and stays inside the container; the picture lies at the default level and only the lifted cards take the raised shadow." A Check row for it.

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse. Held-out: `held-eease`, `held-workos-atlas`.

**Result.**

- `pp-in`, `held-pp`: 2026-11-11, Opus in Claude Code designs and judges. In-sample: shipped (`out-land`) against `candidates/public-pages` (`pp-in`) on alignui-waitlist, hcare-landing and untitled-pricing, 3 runs each. Held-out: `held-ship` against `held-pp` on six `held-*` pages from facts briefs, 2 runs each. Counts are the per-run judge's gap lists (`runs/<round>/gaps.json`); pairwise in both orders, a winner that changed with the order counted as a tie (`runs/out-land-vs-pp-in/`, `runs/held-ship-vs-held-pp/`). hcare-landing: shipped 3/3 ("Lifted cards placed carelessly over the product picture"); candidate 3/3 ("placed out of the first window or off the picture"): the cards no longer cover the chart but moved off the picture or below the fold. "The picture as loud as the cards" stays 2/3 in each. held-helply: both 2/2, a floating card covers the screenshot's content. Pairwise hcare-landing: candidate 2, tie 1. Not shown: the fault moved.
