# ADR 0059: Design gaps are files in the evals, measured by recall

Status: accepted, 2026-11-03.

## Context

A person corrected an editor redesign made with the design skill and found 17 problems the skill
let through, and 7 in how it was run. They were written into a root `DESIGN-LAB-GAPS.md`, one
entry each with a proposed rule. Rules written from one correction tend to fit that correction:
the skill should change only once the lab shows a change makes agents catch the problem, and the
person decides. The lab measured designs remade from references, which says nothing about
whether a reviewer catches what this person caught. A single file also gave agents no way to
find a gap by its status, or to record what the lab found.

## Decision

- A design gap is a file in `evals/gaps/` (`g01-…` for a problem seen in a design, `p01-…` for
  how the skill was run). Its front matter is decoded with `Gap` (`evals/src/gap.ts`): `id`,
  `title`, `kind` (missing, missed, process), `status` (open, testing, done, wontfix), `found`,
  `source`, `skill`, `sections`. Its text says what happened, what the skill says now, the
  proposal, the test, and the results.
- `pnpm evals gaps` lists them. The list is the index; no document repeats it.
- Their pictures stay outside git, in the data directory: the person's in `gaps/<id>/`, and what
  a reviewer is shown in `gaps/sections/<section>/` (pictures dark and light with 2× crops, the
  code at the commit they show), named once for every gap that shares it.
- `pnpm evals recall` measures versions of the skill (the shipped one, a candidate laid over it:
  `SKILL.md` the router, the other files references):
  - A fresh reviewer reviews each section with one version.
  - A judge, told neither the version nor the path, matches the review with the `g` gaps naming
    that section: caught, partly or missed.
  - A `p` gap is measured through the `g` gaps of its sections.
  - What no gap matches is grouped across the section's reviews for the person to rate. A
    section no gap names is held out, all of it for the person.
  - The run writes its line under each gap's **Result.** and sets an open gap to `testing`.
- A change to `skills/ultrapaint/` names the gaps it closes, which become `done`.
- `DESIGN-LAB-GAPS.md` goes.

## Consequences

- An agent finds the gaps from `AGENTS.md` and `pnpm evals gaps`, and adds one there rather than
  editing the skill after a correction.
- Recall on gaps whose candidate rules were written from those very findings is partly by
  construction. The held-out sections are what says whether a rule generalises or adds noise.
- A round's `--skills` can't replace the router: it places a candidate's part files where a
  project's skills go. A change to `SKILL.md` is measured by recall only.
