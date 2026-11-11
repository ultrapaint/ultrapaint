---
id: g07
title: A filled field vanishing on a tinted frame
kind: missing
status: wontfix
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [references/components.md]
sections: [left-card-raised]
---

**What happened.** The canvas picker sat on the rail-toned frame with the fields' usual fill
(`muted`). The fill was so close to the frame that the picker didn't separate from the frame or
from the panel below.

**The fix used.** A translucent fill (`foreground/5`), a hairline ring, and 8px beneath it.

**The skill now.** `components.md` and `DESIGN.md` describe fields as "filled, borderless at
rest". Nothing covers a field on a surface other than the one the fill was chosen for.

**Proposed.** A field's fill contrasts with the surface it sits on. On any other surface, use a
translucent fill and a hairline.

**Test.** Fields placed on each surface of a system, checked for measured contrast against
their ground.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 0/2, redesign-gaps 0/2 (+2 partly) (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): the candidate's rule gave only partly (2 of 2); the captured picker has no fill at rest, only on hover, so check the capture against the person's picture first.
- Decision of 2026-11-03 (`decisions/recall-redesign-1`): the person doesn't remember whether the picker was filled at rest; the capture shows it filled on hover only. It stays `testing`.
- `recall-closing-check-1`: 2026-11-04, caught: shipped 0/2 (+1 partly), closing-check 0/2 (+2 partly) (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- Decision of 2026-11-04 (made by the agent, as the person asked): no rule: a field vanishing into its ground is caught by the shipped skill wherever it shows at rest (Settings' fields, 2/2 in every round). The picker was hover-only in the captures, and the person doesn't remember. The editor fixed it in 4601056.
- `held-out-1`: 2026-11-04, caught: shipped 0/2 (+2 partly), held-out-themes 0/2 (+1 partly), held-out-plain 0/2 (+1 partly) (opus, effort high; runs/held-out-1/report.md)
- `models-1`: 2026-11-04, caught: shipped@opus 0/2 (+2 partly), shipped@gpt-6.1-sol 0/2, shipped@cursor:grok-4.7-high 0/2 (+2 partly), shipped@cursor:composer-2.5 0/2 (+2 partly) (reviewed by opus, gpt-6.1-sol, cursor:grok-4.7-high, cursor:composer-2.5, judged by opus, effort high; runs/models-1/report.md)
- `recall-outline-1`: 2026-11-05, caught: shipped 0/2 (+2 partly), shipped+outline 0/2 (+1 partly) (reviewed by gpt-6.1-sol, judged by opus, effort high; runs/recall-outline-1/report.md)
- `rb-recall-before`: 2026-11-08, caught: shipped 0/2 (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 0/1 (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 0/2 (+1 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
- `ep-1`: 2026-11-10, caught: review-table@opus+untold 0/2 (+1 partly), review-table@opus+told 0/2 (+1 partly), review-table@gpt-6.1-sol+untold 0/2 (+2 partly), review-table@gpt-6.1-sol+told 0/2 (+2 partly) (reviewed by opus, gpt-6.1-sol, judged by cursor:grok-4.7-high, effort high; runs/ep-1/report.md)
