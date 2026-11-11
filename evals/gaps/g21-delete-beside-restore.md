---
id: g21
title: Delete beside Restore in the same style
kind: missing
status: done
found: 2026-11-04
source: the Changes panel, editor redesign at f608871 (held-out finding changes-10, rated real)
skill: [references/states.md]
sections: [changes]
---

**What happened.** In the snapshot row's hover actions, Delete is a ghost icon in the same style right beside Restore and Compare, one slip away, with no visible confirm or undo.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 1/2. The person rated it real
(`decisions/held-out-rest`, changes-10). Theme: danger.

**The skill now.** `states.md`, "Destructive actions confirm or undo": "Ask first, naming what will be lost, or act at once and offer an undo that stays until dismissed." It says *or*, and nothing about where the destructive control sits or a confirm added where an undo exists.

**Proposed.** In `states.md`'s table: "A destructive action beside safe ones in the same style → apart, in the row's menu, or its destructive variant; with its undo"; "A confirm for an action that can be undone → act and offer the undo; a confirm names what is lost, in its title".

**Test.** Recall on `changes`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 1/2, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): closed by the row the candidate `held-out-themes` added to the check table, shipped with the gap's number in its commit. The same row in general words (`held-out-plain`) caught it less often or not at all; the example in the row is what the reviewer recognises.
- `models-1`: 2026-11-04, caught: shipped@opus 1/2, shipped@gpt-6.1-sol 1/2, shipped@cursor:grok-4.7-high 2/2, shipped@cursor:composer-2.5 0/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 2/2, shipped+outline 0/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 2/2, content-single 2/2, copy-outline 2/2 (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- `ep-1`: 2026-11-10, caught: review-table@opus+untold 1/2, review-table@opus+told 2/2, review-table@gpt-6.1-sol+untold 2/2, review-table@gpt-6.1-sol+told 2/2 (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
- `rt-2`: 2026-11-11, caught: shipped 2/3 (+1 partly), review-table 3/3, review-inventory 3/3 (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/rt-2/report.md)
