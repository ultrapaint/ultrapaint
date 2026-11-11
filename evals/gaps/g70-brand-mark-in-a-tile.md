---
id: g70
title: A brand mark boxed in a filled tile
kind: missed
status: testing
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [SKILL.md, references/iconography.md]
sections: []
---

**What happened.** Agents put the logo inside a 32–36px rounded square filled with the accent or black, a second solid block beside the primary action that changes the mark's form (`alignui-waitlist` run 2, `untitled-pricing` both runs; the per-run judge's most frequent gap). Pictures: `gaps/g70/`.

**The skill now.** `SKILL.md`, Icons: "A brand mark keeps its official form."

**Proposed.** "A brand mark keeps its official form, bare in the ink: never on a filled tile unless the official mark is one."

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse.

**Result.**

- `pp-in`, `held-pp`: 2026-11-11, Opus in Claude Code designs and judges. In-sample: shipped (`out-land`) against `candidates/public-pages` (`pp-in`) on alignui-waitlist, hcare-landing and untitled-pricing, 3 runs each. Held-out: `held-ship` against `held-pp` on six `held-*` pages from facts briefs, 2 runs each. Counts are the per-run judge's gap lists (`runs/<round>/gaps.json`); pairwise in both orders, a winner that changed with the order counted as a tie (`runs/out-land-vs-pp-in/`, `runs/held-ship-vs-held-pp/`). In-sample, a mark on a filled tile: shipped 7 of 9 runs ("boxed in a tile and drawn illegibly", all three references), candidate 2 of 9 (alignui; hcare's 3/3 is now "Stand-in mark reads as another sign"). Held-out it doesn't hold: shipped 4 runs with a box or tile around one element, candidate 2 with "Brand mark set on a tile inside a button" (workos) and 6 with "Decorative icons boxed in tiles".
