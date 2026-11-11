---
id: g31
title: A page title that repeats the selected nav item
kind: missed
status: done
found: 2026-11-04
source: the Settings dialog, editor redesign at f608871 (held-out finding settings-16, rated real)
skill: [SKILL.md, references/words/interface.md]
sections: [settings]
---

**What happened.** The "Editor" heading in the content header repeats the selected nav item right beside it. It adds a second semibold heading next to "Settings".

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 0/2, redesign-gaps 1/2. The person rated it real
(`decisions/held-out-rest`, settings-16). Theme: repeat.

**The skill now.** `restraint.md`'s table: "A heading, caption or description that repeats what is beside it → Remove it". It holds for neighbours. A value repeated a panel away (g16), or a route that is its page's name in lower case, isn't "beside".

**Proposed.** In `restraint.md`'s table: "A value the window already shows elsewhere (a size on its frame, a count on its group, a title its nav item names) → once, where it is read or set"; "A second line that is the first in another form (a route that is its name) → only where it differs". Related: g16 (`wontfix`, caught 2/2 on the new chat, 0–1/2 here).

**Test.** Recall on `settings`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `models-smoke`: 2026-11-04, caught: shipped@gpt-6.1-sol 0/1, shipped@cursor:gemini-4-argon 0/1 (+1 partly) (reviewed by gpt-6.1-sol, cursor:gemini-4-argon, judged by opus, effort high; runs/models-smoke/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 0/2, held-out-themes 2/2, held-out-plain 1/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): closed by the row the candidate `held-out-themes` added to the check table, shipped with the gap's number in its commit. The same row in general words (`held-out-plain`) caught it less often or not at all; the example in the row is what the reviewer recognises.
- `models-1`: 2026-11-04, caught: shipped@opus 0/2, shipped@gpt-6.1-sol 0/2, shipped@cursor:grok-4.7-high 0/2 (+1 partly), shipped@cursor:composer-2.5 0/2 (+1 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 1/2, shipped+outline 2/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 2/2, content-single 2/2, copy-outline 1/2 (opus, effort high; runs/recall-copy-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 2/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 1/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 0/2 (+2 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- `ep-1`: 2026-11-10, caught: review-table@opus+untold 0/2, review-table@opus+told 1/2, review-table@gpt-6.1-sol+untold 0/2, review-table@gpt-6.1-sol+told 2/2 (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
