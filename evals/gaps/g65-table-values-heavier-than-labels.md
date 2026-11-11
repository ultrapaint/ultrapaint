---
id: g65
title: Comparison values heavier than their row labels
kind: missed
status: open
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [SKILL.md, references/pages/landing.md]
sections: []
---

**What happened.** On `untitled-pricing` the values of the comparison (10, 20GB, Unlimited) were set medium or semibold in the foreground, as heavy as or heavier than the row labels, so the table read flat. The per-run judge found it in both runs; the pairwise judge named it in run 1. Pictures: `gaps/g65/`.

**The skill now.** `SKILL.md`, Type: "Names in a list take the label style, heavier than their metadata." `landing.md`'s Comparison line says nothing of weight.

**Proposed.** `landing.md`, Comparison: "row labels in the label style; values regular", and a Check row: "Values as heavy as their row labels → Values `400`".

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse.

**Result.**
