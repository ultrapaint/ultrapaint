---
id: g73
title: Stand-in logos drawn as interface icons or crude marks
kind: missing
status: testing
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [references/iconography.md, references/pages/landing.md]
sections: []
---

**What happened.** With no logo given, agents drew customer logos from the interface's icon set or as invented shapes in grey discs (`untitled-pricing` both runs), and brand marks that read as a hash or a ticket (`alignui-waitlist`, `hcare-landing`, one run each). Pictures: `gaps/g73/`.

**The skill now.** Nothing on what a stand-in is.

**Proposed.** A Check row in `landing.md`: "Customer logos drawn as interface icons or invented shapes → Short wordmarks or monograms in one grey, one style, said to the user to be stand-ins"; one in `iconography.md`: "A drawn stand-in brand mark that doesn't read at `24–32px` → One simple shape in the ink, said to be a stand-in".

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse.

**Result.**

- `pp-in`, `held-pp`: 2026-11-11, Opus in Claude Code designs and judges. In-sample: shipped (`out-land`) against `candidates/public-pages` (`pp-in`) on alignui-waitlist, hcare-landing and untitled-pricing, 3 runs each. Held-out: `held-ship` against `held-pp` on six `held-*` pages from facts briefs, 2 runs each. Counts are the per-run judge's gap lists (`runs/<round>/gaps.json`); pairwise in both orders, a winner that changed with the order counted as a tie (`runs/out-land-vs-pp-in/`, `runs/held-ship-vs-held-pp/`). untitled-pricing: shipped 3/3 ("Stand-in customer logos drawn as UI icons"), candidate 2/3 ("Customer logos drawn as letter avatars"). Held-out: shipped 12/12 ("logos without files: faked type and ruled grids"); candidate 10/12 ("stand-ins in mixed faces, boxed or captioned") plus workos 2/2 ("Integration marks drawn as names or monograms"). A pairwise reason (held-attio-pricing run 2): wordmarks in mixed fallback faces read "like a font sampler". Reading: the line moves the fault and doesn't remove it. Rework or drop it.
