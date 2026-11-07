# ADR 0068: The design skill names no site, no person and no paid face

Status: accepted, 2026-11-07. Follows 0057 (the evals' data is outside git).

## Context

The skill's studies (`references/studies/`) were distilled from 4,983 sites people picked and
its patterns from one UI kit's published shots. The prompt that distilled them said to name no
site, but the studies named about 170: companies, magazines, people's own portfolios (some by
the person's name), and six sites the notes found hijacked by spam. They quoted brands' taglines
and product names, and ratings with the review site that gave them. The editorial serif recipe
named three faces, two of them paid (Tiempos Headline, GT Sectra), as the faces to use.

Naming is not copying: no licence is at stake. But the skill ships in a public repository and in
the server, and an agent follows what it reads: it can put a brand's tagline or a rating it has
not earned into a person's page, or load a face nobody paid for.

## Decision

- **A study describes a site by its kind** ("a design conference", "a boutique hotel"), from the
  genre its note records, never by its name, its address or its slug. A list of further sites is
  a count ("six more do the same").
- **Quoted copy is generic.** A brand's tagline, a product's name or a rating naming its source
  is described, or replaced by a line of the same shape; a rating is written only from one the
  product really has.
- **A paid face is counted, never prescribed.** A recipe names free faces (SIL Open Font License,
  as on Google Fonts and Fontsource). A paid face is used only where the product already loads it
  or the user says they hold its licence; otherwise the nearest free face of its character takes
  its place, and the user is told (`design-system/foundations.md`).
- **Nothing taken from another site is committed**: captures, screenshots and page copy are the
  evals' data, outside git (0057).

## Consequences

- The numbers did not change: only the names beside them.
- The software the skill names (shadcn, Tailwind, Phosphor, Lenis: MIT; Lucide: ISC; Atlassian's
  tokens, Style Dictionary: Apache-2.0) is named for its conventions; nothing of it is copied.
  Remix Icon's licence (its own since January 2026) forbids its icons as a logo or brand mark.
- `lab/`, committed by mistake on 2026-10-26 (a site's captures and its copy) and reverted the
  same day, is removed from the history.
