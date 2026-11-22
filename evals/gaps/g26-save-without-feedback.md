---
id: g26
title: A field that saves and loads with nothing shown
kind: missing
status: done
found: 2026-11-04
source: the Settings dialog, editor redesign at f608871 (held-out finding settings-15, rated real)
skill: [references/states.md]
sections: [settings]
---

**What happened.** The Display name field saves silently on blur and is disabled without explanation while loading. It stays disabled for good if loading fails, and save errors go to a global report instead of under the field.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 2/2. The person rated it real
(`decisions/held-out-rest`, settings-15). Theme: states.

**The skill now.** `states.md` draws "Loading, and the error" for what waits on the network, and "Errors sit where they happened". It says nothing about a loading state that never ends when the read fails, a field that saves without showing it, or an empty state that doesn't say the list is empty.

**Proposed.** In `states.md`'s table: "A loading state with no way to end but success → the error in its place, with a retry"; "A field that saves on blur with nothing shown → saving and saved beside it, its error under it"; "An empty state that doesn't say it's empty → \"None yet\" and the action that fills it".

**Test.** Recall on `settings`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `models-smoke`: 2026-11-04, caught: shipped@gpt-6.1-sol 1/1, shipped@cursor:gemini-4-argon 1/1 (reviewed by gpt-6.1-sol, cursor:gemini-4-argon, judged by opus, effort high; runs/models-smoke/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 0/2 (+1 partly), held-out-themes 1/2 (+1 partly), held-out-plain 1/2 (+1 partly) (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): the row ships, but caught it only 1/2 (with one partly): it stays `testing` until a design round shows it.
- `models-1`: 2026-11-04, caught: shipped@opus 0/2 (+1 partly), shipped@gpt-6.1-sol 2/2, shipped@cursor:grok-4.7-high 1/2 (+1 partly), shipped@cursor:composer-2.5 0/2 (+2 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 2/2, shipped+outline 2/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 1/2 (+1 partly), content-single 1/2 (+1 partly), copy-outline 2/2 (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 1/2 (+1 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 1/2 (+1 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- `rt-2`: 2026-11-11, caught: shipped 3/3, review-table 3/3, review-inventory 3/3 (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/rt-2/report.md)
- `ep-1`: 2026-11-11, caught: review-table@opus+untold 0/2 (+1 partly), review-table@opus+told 2/2, review-table@gpt-6.1-sol+untold 2/2, review-table@gpt-6.1-sol+told 2/2 (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
- `rt-2-gpt`: 2026-11-16, caught: shipped 2/2, review-table 2/2, review-inventory 2/2 (reviewed by gpt-6.1-sol, judged by opus, cursor:grok-4.7-high, effort high; runs/rt-2-gpt/report.md)
- `g76-rl`: 2026-11-17, caught: shipped 1/2 (+1 partly), row-lines 2/2 (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/g76-rl/report.md)
- 2026-11-19: `row-lines-2` shipped for g76 (`decisions/rows-nov19`). Its catch of this gap (2 of 2 against 1 of 2) was measured with the first `row-lines` against the skill before #56; it stays `testing` until a recall with the skill on main.
- `recall-main19`: 2026-11-19, caught: shipped 2/2 (opus, effort high; runs/recall-main19/report.md)
- `recall-main19b`: 2026-11-19, caught: shipped 4/4 (opus, effort high; runs/recall-main19b/report.md)
- With the skill on main (row-lines-2 shipped), caught in 6 of 6 reviews: done.
- `up88-told`: 2026-11-22, caught: main+told 3/3, up88-2+told 3/3 (opus, effort high; runs/up88-told/report.md)
- `up88-names`: 2026-11-22, caught: main 3/3, up88-1 3/3, up88-2 3/3 (opus, effort high; runs/up88-names/report.md)
