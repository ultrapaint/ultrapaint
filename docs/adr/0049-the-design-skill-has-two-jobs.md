# ADR 0049: The design skill has two jobs, a screen and its design system

Status: accepted, 2026-11-03. Amends 0048 (the router, the design-system part and the tasks told it). Amended by 0050
(the character settled with the user), 0054 (a missing role, waiting for Sync) and 0067 (a way
in for the words alone).

> Amended by [0069](0069-the-design-skill-is-a-core-and-its-references.md), 2026-11-08: the jobs
> are four steps of the core (a screen or page, reviewing one, the design system, only the
> words); the design system's files are `references/system/` (foundations, components, extract,
> figma), `references/design-system.md` and its folder gone; the server has no built-in part per
> reference.

## Context

0048 made the design skill one router with eighteen parts. The design system ran through all of
them: colour said which neutrals to choose and which to use, typography which face to load and
which text style to set, spacing fixed a radius the character contradicted. An agent designing a
screen was taught to make a system it was only meant to use, and an agent making a system had one
part of 4,000 characters and nothing on extracting one or importing one from Figma. The parts
also contradicted each other on the selected state (the accent's subtle fill, or never a pale
wash), the radius (`12–16px` in spacing, `4–8px` for a technical product in character), what a
"label" is, and whether a remade picture's badges may be tinted.

The skill stays one: one folder to install, no skill depending on another's files, character
shared. The question was where each rule lives inside it.

## Decision

- The router names two jobs. **Designing a screen or page** keeps the steps of 0048 and uses the
  system it is given; its "on every screen" rules no longer choose a face or neutrals. **Making the
  design system** is `references/design-system.md`, a router of its own (steps, what every system
  holds, a finish check) to `references/design-system/`: `foundations.md`, `components.md`,
  `extract.md` and `figma.md`. A project with no system yet takes the foundations' defaults
  before its first screen.
- What each part says about choosing a value moved to the foundations; the screen parts say how to
  use the token, and tell the user when the system's own is wrong rather than overriding it.
- The contradictions are settled: selected is a neutral fill, or a solid brand fill when the
  product draws one, never a pale wash of the accent; the character gives the radius; a *field
  label* is semibold (`600`) and *control text* (navigation, tabs, buttons, menu items) medium
  (`500`); the system has one Badge, neutral, and a screen adds a small coloured dot inside it for
  a status, a remade picture included.
- The server still has one built-in part per top-level reference; `design-system` is told with
  the router to a thread whose task makes the system (`designsTheSystem`): `/init`,
  `/import-figma`, the setup's Define step, and now `/sync figma`, which draws nothing but makes the
  system from Figma's tokens and so is told the skills too.
- Ultrapaint's procedures stay task prompts in the server (which tools, in which order); the
  skill holds the judgement they share with an agent outside the app.

## Consequences

- `figma.md`, `extract.md` and most of `foundations.md` and `components.md` are new writing, not
  measured yet; the design evals need a round for the system job (`extract`, `judge-components`)
  as well as one showing the screen side held.
- A rule that is both a choice and a use is said twice, briefly: the foundations choose it, the
  screen part uses it and points there.
