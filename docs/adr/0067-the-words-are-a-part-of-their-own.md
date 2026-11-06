# ADR 0067: The words are a part of their own, and a product's choices for them are DESIGN.md's Content

Status: accepted, 2026-11-06. Amends 0049 (the design skill's two jobs, now with a way in for the
words alone) and 0027 (DESIGN.md's sections, now with Content). Follows 0065 (DESIGN.md holds what
the product chose).

## Context

The design skill's words were one reference, `references/content.md`: the voice, a screen's
labels, actions, errors and empty states, a public page's headline and subhead, and formats, in
105 lines, with the public page's counts in `studies/content.md`. A task that writes only the
words (a screen's strings rewritten, a page's copy reviewed) had no way in but the screen's steps.
What a product chose for its words had nowhere to go: the design-system job wrote "the voice" in
DESIGN.md with nothing saying where or what.

The DESIGN.md format (`alpha`, `@google/design.md` 0.4.0 and upstream alike) has no section for
words: its Overview holds "the brand personality, target audience, and the emotional response the
UI should evoke", its eight sections are visual, and a section it does not know is kept, not an
error. This repository's DESIGN.md already had a `## Content` of its own.

## Decision

- **The words are a router of their own**, as the design system is: `references/content.md` has
  the steps (settle the voice, read the reference for the place, real words at real lengths, the
  check) and leads to `references/content/`: `voice.md` (the product's choices first, a tone for
  the moment, one name per thing, speaking to the reader), `interface.md` (a screen's labels,
  actions, confirmations, errors, empty states, links, settings, formats) and `pages.md` (a public
  page's first words and prices, with `studies/content.md`). Its rules are the old file's, moved
  and not changed; a new rule starts from a gap, as any other.
- **The router has a way in for the words alone**: a task that writes or reviews only a screen's
  or a page's words reads `references/content.md` and follows its steps. It is recognised from the
  request; there is no command for it, and the briefing does not change.
- **A product's choices for its words are DESIGN.md's Content section**, the one section this tool
  adds to the format, before Do's and Don'ts (design-md's `SECTIONS`, which also reads a `Voice`
  heading as it): how its words sound beyond the tone in Overview, the one name of each thing and
  the words never used for it, its formats. The design-system job writes it from the copy the
  product already has (`design-system.md` step 5, `DESIGN_MD_GUIDE`); a rule that holds for any
  product stays in the skill (0065). The vocabulary is a table there; a separate file only when it
  outgrows the section.
- **What DESIGN.md's Content chose wins over the skill's defaults**, as its tokens do: the voice
  reference says so and checks it in its table.

## Consequences

- A project's copy guide is its DESIGN.md, which agents outside the editor read too; nothing else
  holds the product's words.
- Writing the words with the outline, a copy check on the document and a review model for the
  words alone are left to the lab: each starts as a gap.
- Every DESIGN.md this tool makes has a Content heading; one written elsewhere keeps its sections,
  and a Content added later is placed before its Do's and Don'ts.
