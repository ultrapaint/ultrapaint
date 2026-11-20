---
id: g59
title: Stock marketing phrases and "X. No Y." cadence
kind: missing
status: testing
found: 2026-11-10
source: Impeccable's detector (aphoristic-cadence, marketing-buzzword), kept by the person in `decisions/design-research-nov10`; not a person's correction
skill: [references/words/pages.md, references/words/voice.md]
sections: []
---

**What happened.** Slogans in two fragments set against each other ("Not a feature. A platform.") and stacked buzzwords. Not searched for in our runs.

**The skill now.** `SKILL.md`, Words: "a figure ("750,000+ clients") over an adjective". No rule on the cadence, no list of phrases.

**Proposed.** A words row: two fragments set against each other → one sentence that says what the product does. No list of banned phrases alone: a ban moves a model to the next cliché, so each carries the move to make instead. A check: a copy lint over the page's text.

**Test.** A no-skill outside round on landing references, the headline and subhead of each read by the person; then the same with the candidate.

**Result.**

- `out-land`: 2026-11-11, an outside landing round (Opus in Claude Code, plain React app; alignui-waitlist, hcare-landing, untitled-pricing; 2 runs each), marks counted per page by Opus (`pnpm evals tells`), as mean per page · pages with one, no skill / shipped / `candidates/public-page-tells`: fragments 0 · 0/6 in all three; stock adjectives 0.7 · 4/6, 1.0 · 4/6, 1.0 · 4/6. The adjectives left are the briefs' own copy ("Easy hospital management", "Supercharge your support", "perfect for your team"), kept as given: these references can't measure g59. Blind pairwise, shipped against the candidate: shipped 3, candidate 1, 2 ties (2 of 6 winners changed with the order); the shipped skill against no skill: 6 of 6 (runs/out-land/tells.md, runs/out-land-vs-out-land-tells/)
- `gaps-nov18`, decided (the person, 2026-11-19, `decisions/gaps-nov18`): kept open, measured by the same count. The stock adjectives are gone (0 of 40 fresh pages), but sentence fragments still show on 8 of 40; no rule has been tried.
- `fx-opus-notx`: 2026-11-20, four fresh landing briefs (backup-landing, invoicing-api,
  language-app, meal-kit), 2 runs each, Opus in Claude Code designing with `candidates/not-x`
  (`references/words/pages.md`: "A headline or heading says what the thing does, never what it is
  not", and its Check row), against the same briefs' runs of `fx-opus-main`; fragments counted by
  Opus (`pnpm evals tells`) and split by hand. A heading set against what the thing is not ("Set
  up in minutes, not a sprint", "Pay per invoice, never per payment", "It works in weeks, not
  years"): shipped 4 of 8 runs, candidate 0 of 8 (Fisher one-sided p ≈ 0.04). Two claims stacked
  ("Dinner, decided. Ready in 35 minutes."), which `pages.md` asks for: 3 of 8 in both. The
  candidate's "not" stays in body lines that state a fact ("never creates a second invoice")
  (runs/fx-opus-notx/tells.md).
- `lab-nov20`, answered (the person, 2026-11-20): "it depends. I like some of one and some of the
  other … I would not rely on one single type for headlines", the rest left to the lab. Neither
  kind is a fault by itself; relying on one is. `not-x` is not shipped: it clears one cadence and
  leaves the other as the default. The shipped skill leans on one form: of the 16 landing heroes
  of `fx-opus-main`, 10 are a claim and its continuation in two parts, which `pages.md` offers
  first and sets as the technical hero's. The next candidate, `headline-forms`, names the forms
  with none as the default, and lets a page repeat a cadence (two claims stacked, or one set
  against what it is not) once at most; its round, `fx-opus-hf`, is running on six landing briefs.
- `fx-opus-hf`: 2026-11-20, six fresh landing briefs (backup-landing, invoicing-api,
  language-app, meal-kit, sleep-ring-waitlist, analytics-pricing), 2 runs each, Opus in Claude
  Code designing with `candidates/headline-forms` (`pages.md`: the headline "in the form its words
  need", the forms named with none the default, a page repeating a cadence once at most; the
  technical hero no longer two-tone by rule; its Check row), against `fx-opus-main` on the same
  briefs. Each run's h1 and h2 read from its source and the counter's marks, classified by hand:
  heroes in two parts (a forced break or two sentences) 9 of 12 → 6 of 12; pages whose headings
  repeat one cadence (two stacked pairs, two "X. Y." sentences) 4 of 12 → 1 of 12; pages with a
  "not X" heading 5 of 12 → 4 of 12, each once on its page, as the line allows ("Pay per invoice,
  never per payment" on both invoicing runs). The counter's fragments 8 of 12 → 3 of 12
  (runs/fx-opus-hf/tells.md). The call is asked in `decisions/lab-nov20b`.

