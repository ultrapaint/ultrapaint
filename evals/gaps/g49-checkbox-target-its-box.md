---
id: g49
title: A checkbox whose target is its box
kind: missed
status: done
found: 2026-11-04
source: the Changes panel, editor redesign at f608871 (held-out finding changes-4, rated real)
skill: [references/accessibility.md, references/motion.md]
sections: [changes]
---

**What happened.** Each file row's checkbox is a 16px box whose only hit area is itself, below the 24×24 minimum, next to the much larger diff button.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 1/2. The person rated it real
(`decisions/held-out-rest`, changes-4). Theme: access.

**The skill now.** `accessibility.md`: "Its focus ring is `2px` in the ring colour, `2px` off the edge"; targets "at least `24×24px`" (table: "An icon button under `24px` square"). `motion.md`: "What the keyboard triggers changes instantly." The tables check icon buttons and shortcuts, not a checkbox's target, a ring drawn faint, or a row's fill that fades in as the arrows move the selection.

**Proposed.** In `accessibility.md`'s table: "A focus ring at low opacity or with no offset → `2px`, the ring colour, `3:1`"; "A checkbox or chevron whose target is its 16px box → `24×24` by padding". In `motion.md`'s table: "A selection fill that fades in when the keyboard moves it → instant; fade only on hover".

**Test.** Recall on `changes`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 1/2 (+1 partly), held-out-themes 2/2, held-out-plain 1/2 (+1 partly) (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): closed by the row the candidate `held-out-themes` added to the check table, shipped with the gap's number in its commit. The same row in general words (`held-out-plain`) caught it less often or not at all; the example in the row is what the reviewer recognises.
- `models-1`: 2026-11-04, caught: shipped@opus 1/2 (+1 partly), shipped@gpt-6.1-sol 1/2 (+1 partly), shipped@cursor:grok-4.7-high 0/2 (+2 partly), shipped@cursor:composer-2.5 0/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 2/2, shipped+outline 0/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `recall-copy-1`: 2026-11-06, caught: shipped 2/2, content-single 2/2, copy-outline 2/2 (opus, effort high; runs/recall-copy-1/report.md)
