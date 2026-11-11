---
id: g68
title: A short headline broken onto two lines at a fixed size
kind: missing
status: open
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
