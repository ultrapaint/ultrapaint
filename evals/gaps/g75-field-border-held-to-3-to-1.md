---
id: g75
title: A field's border held to 3:1
kind: missing
status: open
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
