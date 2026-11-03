# Ultrapaint

What Ultrapaint teaches its agents about designing interfaces and their design systems, as one
skill in the Agent Skills layout: `SKILL.md`, a router an agent reads first (its front matter has
the `name` and the `description` an agent picks it by), and `references/`, one file per part of a
design (`layout.md`, `typography.md`…), with `patterns/` (how well-made products build each kind
of screen, counted) and `studies/` (what 4,983 well-made sites do, by character) beneath.

The router has two jobs. Designing a screen or a page uses the design system it is given: the
screen's references say how to use the tokens and components, not how to choose them. Making the
design system is `references/design-system.md`, a router of its own to
`references/design-system/`: `foundations.md` (the face, colour by role, the type scale, spacing,
radius, elevation, motion, icons, widths), `components.md` (making them), `extract.md` (from a
product's code or pictures) and `figma.md` (from a Figma file). `character.md` serves both: it
settles how the product should feel, from DESIGN.md, the product or the user (asked once when
nothing says it), and writes it in DESIGN.md before the first node.

## In Ultrapaint

`pnpm -F @ultrapaint/server skills` writes the skill into the server
(`apps/server/src/skills/design.generated.ts`), and a test fails when the two differ, so run it
after an edit. Each part is a built-in skill there, in the order `apps/server/src/skills/index.ts`
gives: a project replaces or extends one with `<designsDir>/skills/<name>.md`, and the settings
turn one off.

The settings' `skills.briefing` says how a thread is told them: the router with character,
hierarchy and restraint, the agent reading every other part when it reaches it (`router`, the
default), every part whole (`full`), or each by its title and summary (`summaries`). A thread whose
task makes the design system (`/init`, `/import-figma`, `/sync figma`, the setup's Define step) is
told `design-system.md` with the router too. The references are
written to the user's cache (`~/.cache/ultrapaint/skills/<version>/`), the agent sandbox lets
agents read it, and a mention of `` `references/…` `` names the file there.

Each part names principles under headings, with exact values, and ends on a "Before you finish"
table of what to look for and what fixes it. A rule lives in one part and the others leave it
there.

## Where the rules come from

Besides what the skills started with, the design evals (`evals/`): agents remake good reference
screens, a judge and a person compare the results section by section, and the changes that win
are written back here.
