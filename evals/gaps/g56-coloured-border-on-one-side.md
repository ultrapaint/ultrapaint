---
id: g56
title: A coloured border on one side of a card
kind: missed
status: testing
found: 2026-11-10
source: Impeccable's detector (side-tab), kept by the person in `decisions/design-research-nov10`; not a person's correction
skill: [SKILL.md, references/surfaces.md]
sections: []
---

**What happened.** A callout, card or list item marked by a thick accent border on one side only. None was found in the six outside-run pages.

**The skill now.** `SKILL.md`, Colour: "Headings, icons and borders stay neutral." Surfaces: "A border marks an edge that must be seen, in the border token for its role." No row names the one-side accent.

**Proposed.** A row: a callout, card or list item with a thick accent border on one side → the neutral border, or no border and a surface; a status takes a dot and a word. A check: one side at 2px or more in a colour with chroma, the others at 1px or less, on a rounded box.

**Test.** A no-skill outside round on landing and dashboard references, then the same with the candidate.

**Result.**

- `out-land`: 2026-11-11, an outside landing round (Opus in Claude Code, plain React app; alignui-waitlist, hcare-landing, untitled-pricing; 2 runs each), marks counted per page by Opus (`pnpm evals tells`), as mean per page · pages with one, no skill / shipped / `candidates/public-page-tells`: side stripes 0 · 0/6 in all three. None appeared even with no skill: these references can't measure it. Blind pairwise, shipped against the candidate: shipped 3, candidate 1, 2 ties (2 of 6 winners changed with the order); the shipped skill against no skill: 6 of 6 (runs/out-land/tells.md, runs/out-land-vs-out-land-tells/)
