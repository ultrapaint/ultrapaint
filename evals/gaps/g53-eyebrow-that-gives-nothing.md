---
id: g53
title: An eyebrow that gives nothing
kind: missed
status: done
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
- `fx-gpt-ne`: 2026-11-16, GPT-6.1-Sol (the codex agent, plain host) on the 20 fresh briefs and 6 of them twice more, 32 pages, with `candidates/no-eyebrows` against the shipped skill (`fx-gpt`), Opus judging. The candidate states the rule in `SKILL.md`'s Restraint by its look ("a small uppercase or tracked label above a heading, a section or a card, whatever it is called"), adds a line to step 5's check, and drops the eyebrow styles of `pages/landing.md` and `pages/shop.md`. Eyebrows, mean per page · pages with one: shipped 4.9 · 26/32, candidate 0.7 · 14/32; the other tells barely move (fragments 5.3 · 24/32 against 4.7 · 25/32). Blind pairwise, both orders: shipped 18, candidate 10, 4 ties, within chance (a two-sided exact sign test on the 28 verdicts that are not ties gives 0.18); the candidate wins restraint 16 to 10 and loses layout 9 to 18 and hierarchy 10 to 20. 14 of the 32 verdicts name eyebrows as noise. Runs of one brief are 4.0 of 5 alike, shipped 3.8 (`runs/fx-gpt-ne/tells.md`, `runs/fx-gpt-vs-fx-gpt-ne/`).
- `fx-gpt-cg`, `fx-gpt-cgb`, `fx-opus-cgb`: 2026-11-16, the rule inside the combined candidate (`candidates/corpus-nov16`, then `corpus-nov16b` with two fixes for build defects: a headline set in pieces keeps its spaces, every image loads), with the common-ground lines by character and the moves reference. Eyebrows, mean per page · pages with one: GPT-6.1-Sol shipped 4.9 · 26/32, corpus-nov16 0.9 · 16/32, corpus-nov16b 0.8 · 15/32; Opus in Claude Code shipped 0.8 · 8/20, corpus-nov16b 0.3 · 5/20. Blind pairwise against shipped, both orders, Opus judging: with GPT designing corpus-nov16 16, shipped 15, 1 tie; corpus-nov16b 19, shipped 10, 3 ties (sign test 0.14), winning restraint 26 to 5 and hierarchy 20 to 11; with Opus designing corpus-nov16b 12, shipped 6, 2 ties (sign test 0.24), winning layout 11 to 6 and components 12 to 6. No tell rose beyond a page; runs of one brief 4.0 of 5 alike, shipped 3.8 (`runs/fx-gpt-cgb/`, `runs/fx-opus-vs-fx-opus-cgb/`, `runs/fx-gpt-vs-fx-gpt-cgb/`).
- Decision of 2026-11-17 (made by the agent, as the person asked): shipped with `corpus-nov16b`, which beat shipped with both designers and added no tell.
