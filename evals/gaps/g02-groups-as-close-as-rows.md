---
id: g02
title: Groups as close as their rows
kind: missed
status: testing
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [SKILL.md, references/kinds/navigation.md]
sections: [components-panel]
---

**What happened.** In the Components panel, the gap between two groups was about the gap
between rows, so the groups didn't read as separate.

**The skill now.**
- `spacing.md` ("Proximity shows the grouping"): "The gap between groups is at least twice the
  gap within one."
- `patterns/navigation.md` gives padding 16, 24 between groups and 4 within.

**Why it was missed.** The agents applied the rules they could check in the code: type roles,
tokens, no blue washes. A rule about the relationship between two gaps needs the rendered
screen.

**Proposed.** A measured check instead of a new rule. After rendering, read the computed gaps of
each list. Fail when the gap between groups is less than twice the gap within one.

**Test.** Run the measured check and the agent's self-review on the same screens. Compare what
each catches.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 0/2 (+1 partly), redesign-gaps 0/2 (+2 partly) (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): no wording caught it, even from 2× crops: it needs the measured check of the gaps between and within groups.
- Decision of 2026-11-03 (`decisions/recall-redesign-1`): build the measured check (the gap between groups against the gap within one), since no wording caught it.
- `measure-1`: 2026-11-04, `pnpm evals measure` flags it at ratio 3 (27px between the App and System groups, 10px between rows) and not at spacing.md's 2 (it measures 2.7); at 3 it also flags the same pattern in Changes, and nothing in Layers or Settings (runs/measure-1/summary.md). The threshold is the person's call.
- Closed 2026-11-04 by the shipped skill and the measured check: `spacing.md` now asks for at least three times the gap within a group between groups, measured between the text, and `pnpm evals measure` flags under 3× by default (the person's choice of ratio).
- `recall-closing-check-1`: 2026-11-04, caught: shipped 0/2 (+2 partly), closing-check 0/2 (+2 partly) (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 0/1, held-out-themes 0/2 (+1 partly), held-out-plain 0/2 (+2 partly) (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, caught: shipped@opus 0/1, shipped@gpt-6.1-sol 0/2, shipped@cursor:grok-4.7-high 0/2 (+1 partly), shipped@cursor:composer-2.5 0/2 (+1 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 0/2, shipped+outline 0/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 0/2 (+1 partly), content-single 0/2 (+1 partly), copy-outline 0/2 (+1 partly) (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 0/2 (+1 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 0/2 (+2 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 0/2 (+1 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- 2026-11-10: `pnpm evals measure` flags under 2× by default, the ratio ADR 0069 settled for the core ("groups at least 2× the gap within them everywhere"). At 2× this gap's own case is not flagged (27px against 10px, 2.7×); `--ratio 3` still flags it. Whether that case is now fine is the person's call (`decisions/design-research-nov10`).
- Reopened 2026-11-10 by the person (`decisions/design-research-nov10`): the core's 2× (ADR 0069) lets through the case this gap was found on. The candidate `candidates/g02-three-times/` asks for 3× between stacked groups of rows in a panel or a sidebar and leaves 2× elsewhere; `pnpm evals measure --ratio 3` is its check until the candidate is measured and the person decides.
- `rt-2`: 2026-11-11, caught: shipped 0/3 (+1 partly), review-table 1/3, review-inventory 0/3 (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/rt-2/report.md)
- `ep-1`: 2026-11-11, caught: review-table@opus+untold 0/2 (+2 partly), review-table@opus+told 0/2 (+2 partly), review-table@gpt-6.1-sol+untold 0/2 (+1 partly), review-table@gpt-6.1-sol+told 0/2 (+1 partly) (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
- `g02-2`: 2026-11-11, caught: shipped 1/3 (+1 partly), g02-three-times 3/3 (opus, effort high; runs/g02-2/report.md)
- `propose`: 2026-11-11, the fix-or-leave call (Opus with the skill, the prompt of cf5bb6f8) leaves both of this gap's findings in rt-2, citing "the gap between groups is at least 2× the gap within one": it measures about 30px between groups against 8px rows. The lab's check measures 27px against 10px (2.7×) here, and the person corrected it all the same, so the rule's 2× passes what the person rejects (runs/rt-2/propose-gaps.md; gaps/sections/components-panel/checks.json)
