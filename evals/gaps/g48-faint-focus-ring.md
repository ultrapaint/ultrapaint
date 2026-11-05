---
id: g48
title: A focus ring drawn faint
kind: missed
status: wontfix
found: 2026-11-04
source: the Settings dialog, editor redesign at f608871 (held-out finding settings-11, rated real)
skill: [references/accessibility.md, references/motion.md]
sections: [settings]
---

**What happened.** The sidebar nav items' focus ring is the ring colour at 25% opacity with no offset. That falls below the 3:1 contrast a focus indicator needs.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped skill 1/2, redesign-gaps 2/2. The person rated it real
(`decisions/held-out-rest`, settings-11). Theme: access.

**The skill now.** `accessibility.md`: "Its focus ring is `2px` in the ring colour, `2px` off the edge"; targets "at least `24×24px`" (table: "An icon button under `24px` square"). `motion.md`: "What the keyboard triggers changes instantly." The tables check icon buttons and shortcuts, not a checkbox's target, a ring drawn faint, or a row's fill that fades in as the arrows move the selection.

**Proposed.** In `accessibility.md`'s table: "A focus ring at low opacity or with no offset → `2px`, the ring colour, `3:1`"; "A checkbox or chevron whose target is its 16px box → `24×24` by padding". In `motion.md`'s table: "A selection fill that fades in when the keyboard moves it → instant; fade only on hover".

**Test.** Recall on `settings`, shipped against the candidate `held-out-themes`, 2 runs.

**Result.**

- `models-smoke`: 2026-11-04, caught: shipped@gpt-6.1-sol 1/1, shipped@cursor:gemini-4-argon 1/1 (reviewed by gpt-6.1-sol, cursor:gemini-4-argon, judged by opus, effort high; runs/models-smoke/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 2/2, held-out-themes 2/2, held-out-plain 2/2 (opus, effort high; runs/held-out-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked: ship wording where the candidate catches more with no more noise; `held-out-1`, runs/held-out-1/report.md): no new wording: the shipped skill caught it 2/2 with a fresh reviewer per section, so what missed it was how the redesign was run (p02), now step 7 of SKILL.md.
- `models-1`: 2026-11-04, caught: shipped@opus 2/2, shipped@gpt-6.1-sol 2/2, shipped@cursor:grok-4.7-high 2/2, shipped@cursor:composer-2.5 2/2 (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 2/2, shipped+outline 0/2 (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
