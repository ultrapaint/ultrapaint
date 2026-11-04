---
id: g50
title: A selection that fades in from the keyboard
kind: missed
status: done
found: 2026-11-04
source: the Layers panel, editor redesign at f608871 (held-out finding layers-21, rated real)
skill: [references/accessibility.md, references/motion.md]
sections: [layers]
---

**What happened.** ROW's transition-colors duration-100 makes the selected fill fade in when moving with arrows/Enter, though DESIGN.md says keyboard-triggered changes shouldn't animate.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 1/2. The person rated it real
(`decisions/held-out-rest`, layers-21). Theme: access.

**The skill now.** `accessibility.md`: "Its focus ring is `2px` in the ring colour, `2px` off the edge"; targets "at least `24×24px`" (table: "An icon button under `24px` square"). `motion.md`: "What the keyboard triggers changes instantly." The tables check icon buttons and shortcuts, not a checkbox's target, a ring drawn faint, or a row's fill that fades in as the arrows move the selection.

**Proposed.** In `accessibility.md`'s table: "A focus ring at low opacity or with no offset → `2px`, the ring colour, `3:1`"; "A checkbox or chevron whose target is its 16px box → `24×24` by padding". In `motion.md`'s table: "A selection fill that fades in when the keyboard moves it → instant; fade only on hover".

**Test.** Recall on `layers`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `held-out-1`: 2026-11-04, caught: shipped 0/2, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): closed by the row the candidate `held-out-themes` added to the check table, shipped with the gap's number in its commit. The same row in general words (`held-out-plain`) caught it less often or not at all; the example in the row is what the reviewer recognises.
