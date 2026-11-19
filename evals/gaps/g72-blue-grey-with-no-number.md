---
id: g72
title: Blue-grey greys where the rule has no number to check
kind: missed
status: wontfix
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
- `flow-*`: 2026-11-17, the four flow briefs of ADR 0101 (a checkout, inviting people to a workspace, booking on a phone, cancelling a subscription), every screen photographed, 2 runs each; Opus in Claude Code designing all three versions (no skill, the skill as merged in PR #21, `candidates/one-value`: g61's seven values made one, g72's greys by the primary's temperature, g75's quiet field border), GPT-6.1-Sol no skill whole and the other two on the checkout and invite only (Codex's week ran out); Opus judging both orders, use (ADR 0101) a level of its own. Shipped against no skill: Opus 8 of 8 (5 clear both orders), GPT 4 of 4 (3 clear); use Opus 3 to 2, 3 ties (no skill won both invite runs' use: a persistent sent banner, the domain rule stated twice), GPT 3 to 0. Shipped against the candidate: Opus 3, candidate 1, 4 ties; GPT candidate 2, shipped 1, 1 tie; no margin clear both orders; use shipped 5 to 2. The judges' reasons are each run's own: photos left out for initials, a date-of-birth placeholder read as a value, an arrival date in a sentence. Eyebrows per page Opus 1.4 / 0.3 / 0, GPT 5.4 / 0.5 / 0.3; GPT fragments 0.3 · 1/4 shipped against 1.5 · 2/4 candidate, one page (`runs/flow-*`, `.work/flows-greys.md`). Blue-grey greys, counted from each run's source (Tailwind slate or gray, or a hex over OKLCH chroma `0.01` at a hue of `200–280`): no run of any version mostly blue-grey, 0 of 40; in the fresh rounds `fx-gpt` and `fx-opus`, 7 of 32 and 4 of 20 runs use any, none mostly. The fault does not recur where it can be counted, so the candidate's line has nothing to show and is not shipped; the gap stays open on the person's rework (greys by the primary's temperature) until a round shows the fault again.
- `gaps-nov18`, decided (the person, 2026-11-19, `decisions/gaps-nov18`): closed as won't fix. No run of any version in the flows round was mostly blue-grey (0 of 40), and in the fresh rounds 4 of 20 Opus runs used any, none mostly: the rework has nothing to fix where it can be counted.
