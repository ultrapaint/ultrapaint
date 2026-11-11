---
id: g57
title: A coloured glow as a card's shadow
kind: missed
status: testing
found: 2026-11-10
source: Impeccable's detector (dark-glow, radial-halo), kept by the person in `decisions/design-research-nov10`; not a person's correction
skill: [SKILL.md, references/surfaces.md, references/pages/landing.md, references/pages/title.md]
sections: []
---

**What happened.** Cards or buttons on a dark page lit by a coloured, blurred shadow with no offset. None was found in the six outside-run pages.

**The skill now.** `SKILL.md`, Surfaces: "a shadow belongs to a level, never a custom one". `references/pages/landing.md`: "A glow or pattern behind several sections → One, behind the hero, or none." `references/color.md` allows a glow behind a product screenshot.

**Proposed.** A row: a coloured or zero-offset shadow on a card or a button → the level's shadow; a glow is one light behind the product picture. A check: a box-shadow layer with chroma, a blur above 4px and no offset.

**Test.** A no-skill outside round on dark landing references, then the same with the candidate.

**Result.**

- `out-land`: 2026-11-11, an outside landing round (Opus in Claude Code, plain React app; alignui-waitlist, hcare-landing, untitled-pricing; 2 runs each), marks counted per page by Opus (`pnpm evals tells`), as mean per page · pages with one, no skill / shipped / `candidates/public-page-tells`: glow 0.8 · 4/6, 0 · 0/6, 0.2 · 1/6. The shipped skill already removes it here. Blind pairwise, shipped against the candidate: shipped 3, candidate 1, 2 ties (2 of 6 winners changed with the order); the shipped skill against no skill: 6 of 6 (runs/out-land/tells.md, runs/out-land-vs-out-land-tells/)
