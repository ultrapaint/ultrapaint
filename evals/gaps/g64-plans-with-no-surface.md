---
id: g64
title: Plans laid out with no surface
kind: missed
status: wontfix
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [SKILL.md, references/pages/landing.md]
sections: []
---

**What happened.** On `untitled-pricing` run 1 the three plans were bare text columns over the comparison; the no-skill runs held each in a quiet card, and components went to no skill in both orders of the pairwise. Pictures: `gaps/g64/`.

**The skill now.** `SKILL.md`, Spacing: "Where a screen or dialog does several jobs (a link to copy, people to invite, a plan to choose), each job sits on its own quiet surface". Also there: "A page section is not a card unless it holds a job", which the run followed instead.

**Proposed.** A Check row in `landing.md`: "Plans as bare text columns → Each plan its own quiet card (a `1px` border or a faint fill, the large radius)".

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse.

**Result.**

- `pp-in`, `held-pp`: 2026-11-11, Opus in Claude Code designs and judges. In-sample: shipped (`out-land`) against `candidates/public-pages` (`pp-in`) on alignui-waitlist, hcare-landing and untitled-pricing, 3 runs each. Held-out: `held-ship` against `held-pp` on six `held-*` pages from facts briefs, 2 runs each. Counts are the per-run judge's gap lists (`runs/<round>/gaps.json`); pairwise in both orders, a winner that changed with the order counted as a tie (`runs/out-land-vs-pp-in/`, `runs/held-ship-vs-held-pp/`). untitled-pricing: shipped 1/3, candidate 0/3; pairwise reasons for the candidate's run 1 name "each plan in its own quiet card". Held-out: neither version raised it.
- Set aside 12 November (`lab-direction-nov12`): the person: "it depends" (a card on the recommended plan alone is another way).
- 12 November: set aside under ADR 0082. It is one reference's recipe, and the skill is no longer measured against the page a rule came from; a fault of this kind that recurs on fresh briefs opens a gap of its own.
