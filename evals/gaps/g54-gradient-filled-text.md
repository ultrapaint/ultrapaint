---
id: g54
title: Gradient-filled text
kind: missing
status: testing
found: 2026-11-10
source: Impeccable's detector (gradient-text), kept by the person in `decisions/design-research-nov10`; not a person's correction
skill: [SKILL.md, references/color.md]
sections: []
---

**What happened.** A headline's words filled with a gradient: one of the looks a model gives a public page by default, by the detector's list. None was found in the six outside-run pages, with or without the skill.

**The skill now.** `SKILL.md`, Colour: "A gradient is light on a public page, never a surface for navigation, cards or controls." `references/color.md`, Gradients: "A gradient is light: a glow behind a product screenshot, a wash in a hero…". Nothing about text.

**Proposed.** Emphasis in a headline is weight, size, one word in the accent or the italic, never a gradient fill. A check: `background-clip: text` with a gradient image.

**Test.** A no-skill outside round on landing references: whether it appears at all, then the same with the candidate.

**Result.**

- `out-land`: 2026-11-11, an outside landing round (Opus in Claude Code, plain React app; alignui-waitlist, hcare-landing, untitled-pricing; 2 runs each), marks counted per page by Opus (`pnpm evals tells`), as mean per page · pages with one, no skill / shipped / `candidates/public-page-tells`: gradient text 0.3 · 2/6, 0 · 0/6, 0 · 0/6. The shipped skill already leaves none here. Blind pairwise, shipped against the candidate: shipped 3, candidate 1, 2 ties (2 of 6 winners changed with the order); the shipped skill against no skill: 6 of 6 (runs/out-land/tells.md, runs/out-land-vs-out-land-tells/)
