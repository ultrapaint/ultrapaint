---
id: g75
title: A field's border held to 3:1
kind: missing
status: testing
found: 2026-11-11
source: the editor's fields and selects (Settings), commit 0da4a35b, corrected by the person
skill: [SKILL.md, references/accessibility.md, references/components.md]
sections: [settings]
---

**What happened.** A review held the editor's field and select borders to 3:1 on a card, and
`{input}` went from a faint line (about 1.3:1) to a solid grey (3.1:1 light, 3.3:1 dark). Every
field and select in Settings then drew a bright frame that outweighed its value. The person
called it awful and set the border to about 1.4:1, as T3 Code's selects draw it (1.4:1 measured,
its top edge 1.7:1). Only the focus ring stays held to 3:1.

**The skill now.** `SKILL.md`, Accessibility: "Contrast meets AA: text `4.5:1`; large text …,
icons, field borders and focus rings `3:1`." `references/accessibility.md`: "then a field's
border on a tinted surface: compute those pairs before any other."

WCAG 1.4.11 asks 3:1 only of what is needed to identify a control. A select showing its value and
a chevron, or a field filled apart from its surface or named by its row's label, is identified
without its border, and the border is then an edge like any other.

**Proposed.** In `SKILL.md`, Accessibility: "focus rings `3:1`; a field's border `3:1` only when
nothing else shows the field is there (no fill, no value, no label beside it), else a quiet line
about `1.3–1.6:1`." In `references/accessibility.md`, the same pair named under Contrast: "A
field's border that is its only sign → 3:1; one beside a fill, a value or a chevron → quiet."

**Test.** Recall on `settings` with the editor's fields at 1.4:1: the shipped skill flags their
borders as failing contrast; the candidate leaves them and still flags a bare text field drawn
at 1.4:1 with no fill and no label.

**Result.**
- 12 November: g71 merged here: on `alignui-waitlist` both outside runs darkened the resting field border to 3.2–3.4:1, and the person found it too dark (`decisions/public-pages-ship`). Tested on fresh briefs with fields, and on `settings` as **Test.** says.
- `flow-*`: 2026-11-17, the four flow briefs of ADR 0101 (a checkout, inviting people to a workspace, booking on a phone, cancelling a subscription), every screen photographed, 2 runs each; Opus in Claude Code designing all three versions (no skill, the skill as merged in PR #21, `candidates/one-value`: g61's seven values made one, g72's greys by the primary's temperature, g75's quiet field border), GPT-6.1-Sol no skill whole and the other two on the checkout and invite only (Codex's week ran out); Opus judging both orders, use (ADR 0101) a level of its own. Shipped against no skill: Opus 8 of 8 (5 clear both orders), GPT 4 of 4 (3 clear); use Opus 3 to 2, 3 ties (no skill won both invite runs' use: a persistent sent banner, the domain rule stated twice), GPT 3 to 0. Shipped against the candidate: Opus 3, candidate 1, 4 ties; GPT candidate 2, shipped 1, 1 tie; no margin clear both orders; use shipped 5 to 2. The judges' reasons are each run's own: photos left out for initials, a date-of-birth placeholder read as a value, an arrival date in a sentence. Eyebrows per page Opus 1.4 / 0.3 / 0, GPT 5.4 / 0.5 / 0.3; GPT fragments 0.3 · 1/4 shipped against 1.5 · 2/4 candidate, one page (`runs/flow-*`, `.work/flows-greys.md`). Field borders are not counted in this round: the judges named no field border, either way. Not shipped with g61; the gap waits for the recall its **Test.** names (the `settings` section, which `g76-rl` reviews as well).
- `g76-rl`: 2026-11-17, caught: shipped 0/2, row-lines 0/2 (reviewed by opus, judged by opus, cursor:grok-4.7-high, effort high; runs/g76-rl/report.md)
- `recall-main19`: 2026-11-19, caught: shipped 0/2 (opus, effort high; runs/recall-main19/report.md)
- `recall-main19b`: 2026-11-19, caught: shipped 0/4 (+1 partly) (opus, effort high; runs/recall-main19b/report.md)
- `up88-told`: 2026-11-22, caught: main+told 0/3 (+1 partly), up88-2+told 0/3 (opus, effort high; runs/up88-told/report.md)
- `up88-names`: 2026-11-22, caught: main 0/3, up88-1 0/3, up88-2 0/3 (+1 partly) (opus, effort high; runs/up88-names/report.md)
