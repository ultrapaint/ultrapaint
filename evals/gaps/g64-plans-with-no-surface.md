---
id: g64
title: Plans laid out with no surface
kind: missed
status: open
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
