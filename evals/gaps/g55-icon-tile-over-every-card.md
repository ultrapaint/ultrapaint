---
id: g55
title: An icon tile above every card's heading
kind: missed
status: testing
found: 2026-11-10
source: Impeccable's detector (icon-tile-stack), kept by the person in `decisions/design-research-nov10`; not a person's correction
skill: [SKILL.md, references/iconography.md, references/pages/landing.md]
sections: []
---

**What happened.** A row of feature cards, each opening on one icon in a rounded tinted square above its heading: the detector's most common mark of a generated landing page. Not searched for in our runs.

**The skill now.** `SKILL.md`, Icons: "An icon earns its place where it speeds recognition: not on headings, eyebrows, names, plain links or every bullet". `references/iconography.md` sizes icons "`24px` and up for empty states and feature tiles".

**Proposed.** A feature card leads with its heading, a figure or a picture of the product; a row of cards never shares one icon in a rounded square over each heading. A check: a 32–128px near-square filled box holding an icon as the previous sibling of a heading, three or more times.

**Test.** A no-skill outside round on landing references, then the same with the candidate; the check's count per page.

**Result.**

- `out-land`: 2026-11-11, an outside landing round (Opus in Claude Code, plain React app; alignui-waitlist, hcare-landing, untitled-pricing; 2 runs each), marks counted per page by Opus (`pnpm evals tells`), as mean per page · pages with one, no skill / shipped / `candidates/public-page-tells`: icon tiles 0 · 0/6 in all three. None appeared even with no skill: these references can't measure it. Blind pairwise, shipped against the candidate: shipped 3, candidate 1, 2 ties (2 of 6 winners changed with the order); the shipped skill against no skill: 6 of 6 (runs/out-land/tells.md, runs/out-land-vs-out-land-tells/)
