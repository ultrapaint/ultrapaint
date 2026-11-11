---
id: g58
title: Numbered section labels on content that is not a sequence
kind: missing
status: testing
found: 2026-11-10
source: Impeccable's detector (numbered-section-labels), kept by the person in `decisions/design-research-nov10`; not a person's correction
skill: [references/words/pages.md, references/pages/landing.md]
sections: []
---

**What happened.** "01 / 02 / 03" set beside section headings whose order says nothing. Not searched for in our runs.

**The skill now.** `references/words/pages.md` lists what an eyebrow may hold: "a sequence ("01 · Agents research", "Step 4")". No rule says when a number is one.

**Proposed.** A number labels a section only where the order is information: steps, a timeline, a ranking. A check: two or more small numeric labels beside section headings. See g53: a number is an eyebrow too.

**Test.** A no-skill outside round on landing references, then the same with the candidate; each numbered label rated by whether its sections are ordered.

**Result.**

- `out-land`: 2026-11-11, an outside landing round (Opus in Claude Code, plain React app; alignui-waitlist, hcare-landing, untitled-pricing; 2 runs each), marks counted per page by Opus (`pnpm evals tells`), as mean per page · pages with one, no skill / shipped / `candidates/public-page-tells`: numbered labels 0 · 0/6 in all three. None appeared even with no skill: these references can't measure it. Blind pairwise, shipped against the candidate: shipped 3, candidate 1, 2 ties (2 of 6 winners changed with the order); the shipped skill against no skill: 6 of 6 (runs/out-land/tells.md, runs/out-land-vs-out-land-tells/)
