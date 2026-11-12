---
id: g72
title: Blue-grey greys where the rule has no number to check
kind: missed
status: testing
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [SKILL.md, references/color.md]
sections: []
---

**What happened.** Agents with the skill picked slate greys (#5f6573, #868c98, #5e6b72) for muted text, borders and skeletons in 2 of 6 runs (`alignui-waitlist` run 2, `hcare-landing` run 2), so the second text level read cold. Pictures: `gaps/g72/`.

**The skill now.** `SKILL.md`, Colour: "Neutrals neutral or warm, unless the user asked for a cool feel". No value tells a reviewer or the agent when a grey is blue.

**Proposed.** Give the line a number: "a grey whose OKLCH chroma is over `0.01` at a hue of `200–280` is blue-grey", and a Check row in `color.md`.

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse. Counted per run from the tokens, without a judge.

**Result.**

- `pp-in`, `held-pp`: 2026-11-11, Opus in Claude Code designs and judges. In-sample: shipped (`out-land`) against `candidates/public-pages` (`pp-in`) on alignui-waitlist, hcare-landing and untitled-pricing, 3 runs each. Held-out: `held-ship` against `held-pp` on six `held-*` pages from facts briefs, 2 runs each. Counts are the per-run judge's gap lists (`runs/<round>/gaps.json`); pairwise in both orders, a winner that changed with the order counted as a tie (`runs/out-land-vs-pp-in/`, `runs/held-ship-vs-held-pp/`). Shipped 3 of 9 runs ("Blue-grey neutrals on a character that is not cool"), candidate 0 of 9; held-out, neither raised. The count from the tokens, without a judge, is not done yet.
- The person, 11 November (`public-pages-ship`): blue-grey is judged against the character's primary: a cool primary allows cooler neutrals, a warm one warm. The fixed chroma-and-hue number is to be reworked into that before a candidate.
