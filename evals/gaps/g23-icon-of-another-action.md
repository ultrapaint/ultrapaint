---
id: g23
title: An icon the window uses for another action
kind: missed
status: done
found: 2026-11-04
source: the Changes panel, editor redesign at f608871 (held-out finding changes-8, rated real)
skill: [references/iconography.md]
sections: [changes]
---

**What happened.** The Undo2 arrow on Restore/Revert is the same icon as the editor's undo in the toolbar, so one glyph means two different things on screen.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 0/2, redesign-gaps 1/2. The person rated it real
(`decisions/held-out-rest`, changes-8). Theme: meaning.

**The skill now.** `iconography.md`, "One meaning per icon": "The same action has the same icon everywhere, and one icon means one thing on a screen." The table row is "The same icon for two actions", read within one panel; nothing checks an icon against its own tooltip.

**Proposed.** In `iconography.md`'s table: "An icon used elsewhere on screen for another action (the editor's undo for a restore) → one icon per meaning across the window"; "An icon and its tooltip that say different things (a back arrow named Close) → one meaning: change the icon or the name".

**Test.** Recall on `changes`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 0/2 (+2 partly), held-out-themes 2/2, held-out-plain 0/2 (+1 partly) (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): closed by the row the candidate `held-out-themes` added to the check table, shipped with the gap's number in its commit. The same row in general words (`held-out-plain`) caught it less often or not at all; the example in the row is what the reviewer recognises.
- `models-1`: 2026-11-04, caught: shipped@opus 0/2 (+2 partly), shipped@gpt-6.1-sol 0/2, shipped@cursor:grok-4.7-high 0/2 (+1 partly), shipped@cursor:composer-2.5 0/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 2/2, shipped+outline 2/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 2/2, content-single 2/2, copy-outline 2/2 (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 0/2 (+1 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 0/2 (+2 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- `ep-1`: 2026-11-10, caught: review-table@opus+untold 0/2 (+1 partly), review-table@opus+told 2/2, review-table@gpt-6.1-sol+untold 0/2, review-table@gpt-6.1-sol+told 2/2 (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
- `rt-2`: 2026-11-11, caught: shipped 3/3, review-table 3/3, review-inventory 3/3 (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/rt-2/report.md)
