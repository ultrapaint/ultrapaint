---
id: g68
title: A short headline broken onto two lines at a fixed size
kind: missing
status: testing
found: 2026-11-11
source: the outside landing rounds `out-land` and `out-land-none` (Opus in Claude Code, plain React app, 2026-11-11), judged per run and blind pairwise; kept by the person in `decisions/skill-plan-nov11`
skill: [references/pages/landing.md, references/typography.md]
sections: []
---

**What happened.** On `hcare-landing` run 1 the 25-character headline "Easy hospital management." went onto two lines at 64px medium and lost hierarchy to the reference's one line; wherever a page set it on one line (shipped run 2, the candidate's run 2) it won layout and hierarchy in both pairwise rounds. Run 2 tracked it at `-0.035em`, closing its word spaces. The person: "One line under about 30 characters". Pictures: `gaps/g68/`.

**The skill now.** `references/pages/landing.md`, Hero: "the headline, 2–4 lines". `references/typography.md`: "The hero: one size, about `62px`. Regular or medium; tracked `-0.02em` to `-0.03em`".

**Proposed.** `landing.md`: "the headline: one line under about 30 characters, else 2–4 lines; a set-apart phrase gets its own line by a forced break, not by a width cap". `typography.md`: "The hero: one size, `56–88px`, larger as the headline is shorter". A Check row: "A headline under 30 characters on two lines, or tracked tighter than `-0.03em` → One line, sized up; `-0.02em` to `-0.03em`".

**Test.** In-sample: `out-land` against `candidates/public-pages` on the three references, 3 runs each; the per-run judge's gap should be gone, and the pairwise level no worse. Held-out: the six `held-*` pages' heroes.

**Result.**

- `pp-in`, `held-pp`: 2026-11-11, Opus in Claude Code designs and judges. In-sample: shipped (`out-land`) against `candidates/public-pages` (`pp-in`) on alignui-waitlist, hcare-landing and untitled-pricing, 3 runs each. Held-out: `held-ship` against `held-pp` on six `held-*` pages from facts briefs, 2 runs each. Counts are the per-run judge's gap lists (`runs/<round>/gaps.json`); pairwise in both orders, a winner that changed with the order counted as a tie (`runs/out-land-vs-pp-in/`, `runs/held-ship-vs-held-pp/`). Tracking: shipped 2/3 on hcare-landing ("tracked tighter than the range"), candidate 0/9; held-out, shipped 6 of 12 ("Tight tracking stacked on tight, condensed or serif faces"), candidate 0 of 12. Line breaks: shipped 2 of 9 ("undersized and wrapped by a narrow column"), candidate 3 of 9 ("Line breaks left to balance or a width cap"); held-out, 2 of 12 each. Pairwise hcare-landing hierarchy: candidate 2, tie 1. The candidate's 3 breaks are not short headlines: twice `text-wrap: balance` broke AlignUI's 41-character headline so a grey "the" led the emphasised line, once a width cap split a subhead mid-sentence; hcare-landing's 25-character headline, the only short one, stayed on one line in all 3 candidate runs. Reading: the tracking bound works on both sets; the one-line rule held where it applied, and the break before a set-apart phrase needs its own line (no `text-wrap: balance` on it).
