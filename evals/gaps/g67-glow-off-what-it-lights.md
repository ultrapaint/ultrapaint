---
id: g67
title: A glow placed off what it lights
kind: missing
status: testing
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [references/pages/landing.md]
sections: []
---

**What happened.** On `alignui-waitlist` (both runs) and `hcare-landing` run 2 the hero's glow was centred above the content, started under a white header and left a straight seam, or had its rim behind the eyebrow. The per-run judge found it in 3 runs. Pictures: `gaps/g67/`.

**The skill now.** `landing.md`, Check: "A glow or pattern behind several sections → One, behind the hero, or none". Nothing on where the one goes.

**Proposed.** A Check row: "A glow whose centre is above the content it lights, whose rim crosses text, or that stops in a straight edge at the header → Centred on the mark or picture it lights, fading to the ground before any text or edge".

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse.

**Result.**

- `pp-in`, `held-pp`: 2026-11-11, Opus in Claude Code designs and judges. In-sample: shipped (`out-land`) against `candidates/public-pages` (`pp-in`) on alignui-waitlist, hcare-landing and untitled-pricing, 3 runs each. Held-out: `held-ship` against `held-pp` on six `held-*` pages from facts briefs, 2 runs each. Counts are the per-run judge's gap lists (`runs/<round>/gaps.json`); pairwise in both orders, a winner that changed with the order counted as a tie (`runs/out-land-vs-pp-in/`, `runs/held-ship-vs-held-pp/`). Shipped 3 of 9 runs ("glow placed off its content"), candidate 2 of 9 ("Glow rim visible as a grey arc or haze"). Held-out: shipped 1 (a glow repeated behind sections), candidate 2 ("Glows repeated or cut"). Tells, glows per page · pages with one: no skill 1.7 · 9/12, shipped 0.3 · 3/12, candidate 0.2 · 2/12 (`runs/held-pp/tells.md`). Not shown: the same count, with other faults.
