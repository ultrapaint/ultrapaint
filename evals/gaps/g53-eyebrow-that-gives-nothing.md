---
id: g53
title: An eyebrow that gives nothing
kind: missed
status: testing
found: 2026-11-10
source: the person, on the public-page tells (decisions/design-research-nov10)
skill: [SKILL.md, references/typography.md, references/words/pages.md, references/pages/landing.md, references/pages/shop.md, references/pages/editorial.md]
sections: []
---

**What happened.** The person, asked whether to hold a rule against an eyebrow over every section heading: "I want no eyebrow at all unless really necessary and intentional and if it gives value. 99.99% percent of all eyebrows that AI generates are just slop. You can re-evaluate it but that's my stance and I would prefer to not see, not even one unless it really make sense." One no-skill share dialog of the outside runs (`rb-out-*`) has two tracked uppercase labels; its run with the skill has none.

**The skill now.** 
- `SKILL.md`, Restraint: "no intro, eyebrow or subtitle on a screen whose purpose is plain".
- `references/typography.md`: "An eyebrow stays only when it states a fact the heading does not", and the row "An eyebrow that states nothing the heading does not → Remove it".
- `references/words/pages.md` has a part "The eyebrow", three recipes that carry one ("the news eyebrow", a kicker on every story) and the row "An eyebrow naming what its heading names → Delete it; keep news, proof, a number or a category".
- `references/pages/landing.md` gives eyebrows a style ("Uppercase mono carries eyebrows"), as `shop.md` and `editorial.md` do.

The rule allows an eyebrow that adds a fact; the page files hand out a style for one, which reads as an invitation.

**Proposed.** The default is none. A page or a screen has an eyebrow only where it was chosen for what it says and the heading cannot say it: news with a date, a proof, a number, a story's category in a publication. Never one a section, never one that names the section, the product or the kind of content. The page files say when an eyebrow exists before they say how it is set. A check: small tracked uppercase labels directly above headings, flagged from the first on a product screen and from the second on a page.

**Test.** An outside landing round with and without the skill, and with the candidate: eyebrows counted per page in the source and the pictures, each rated by the person as earned or not.

**Result.**

- `out-land`: 2026-11-11, an outside landing round (Opus in Claude Code, plain React app; alignui-waitlist, hcare-landing, untitled-pricing; 2 runs each), marks counted per page by Opus (`pnpm evals tells`), as mean per page · pages with one, no skill / shipped / `candidates/public-page-tells`: eyebrow 0.8 · 4/6, 0.3 · 2/6, 0.3 · 2/6. The eyebrows left with the skill and the candidate are the brief's own label ("AlignUI Design System" over the waitlist heading), which a design keeps as given: these references can't measure g53; a brief that hands no label over a heading can. Blind pairwise, shipped against the candidate: shipped 3, candidate 1, 2 ties (2 of 6 winners changed with the order); the shipped skill against no skill: 6 of 6 (runs/out-land/tells.md, runs/out-land-vs-out-land-tells/)
- `held-pp`: 2026-11-11, six `held-*` pages from facts briefs (no copy handed over), 2 runs each, Opus in Claude Code; marks counted per page by Opus, as mean per page · pages with one, for no skill / shipped / `candidates/public-pages`: eyebrows 3.7 · 12/12, 0.2 · 2/12, 0 · 0/12 (`runs/held-pp/tells.md`). The person's rating of each eyebrow as earned or not is still to do.
