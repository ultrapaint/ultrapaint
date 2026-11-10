---
id: g60
title: A card with a hairline border and a wide soft shadow
kind: missed
status: open
found: 2026-11-10
source: Impeccable's detector (gpt-thin-border-wide-shadow), kept by the person in `decisions/design-research-nov10`; not a person's correction
skill: [SKILL.md, references/surfaces.md]
sections: []
---

**What happened.** A card drawn with a 1px border and, under it, a wide, faint shadow of its own: two edges for one surface. Not searched for in our runs.

**The skill now.** `SKILL.md`, Surfaces: "a shadow belongs to a level, never a custom one"; Spacing: "a line or a surface, never both". `references/surfaces.md` has the row "A custom `box-shadow` string → The level's shadow, or ask the user for a new level".

**Proposed.** No new rule: a case for the checker. A check: a 1px border on a box whose shadow has a blur of 24px or more at low alpha and matches no level of the system.

**Test.** The check run on the outside rounds' pages and on the references, which are the false-alarm set.

**Result.**
