---
id: g22
title: A blocking confirm for what undo can take back
kind: missing
status: testing
found: 2026-11-04
source: the Changes panel, editor redesign at f608871 (held-out finding changes-31, rated real)
skill: [references/states.md]
sections: [changes]
---

**What happened.** The "Revert to this checkpoint?" dialog says undo can take it back, yet it still blocks with a three-sentence confirm whose title doesn't name the checkpoint.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 0/2, redesign-gaps 1/2. The person rated it real
(`decisions/held-out-rest`, changes-31). Theme: danger.

**The skill now.** `states.md`, "Destructive actions confirm or undo": "Ask first, naming what will be lost, or act at once and offer an undo that stays until dismissed." It says *or*, and nothing about where the destructive control sits or a confirm added where an undo exists.

**Proposed.** In `states.md`'s table: "A destructive action beside safe ones in the same style → apart, in the row's menu, or its destructive variant; with its undo"; "A confirm for an action that can be undone → act and offer the undo; a confirm names what is lost, in its title".

**Test.** Recall on `changes`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 0/2 (+1 partly), held-out-themes 1/2 (+1 partly), held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): the row ships, but caught it only 1/2 (with one partly): it stays `testing` until a design round shows it.
- `models-1`: 2026-11-04, caught: shipped@opus 0/2 (+1 partly), shipped@gpt-6.1-sol 0/2 (+2 partly), shipped@cursor:grok-4.7-high 0/2, shipped@cursor:composer-2.5 0/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 2/2, shipped+outline 2/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 2/2, content-single 2/2, copy-outline 2/2 (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 1/2 (+1 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 0/2 (+1 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 0/2 (+1 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
