# Ultrapaint

What Ultrapaint teaches its agents about designing interfaces, as one skill in the Agent Skills
layout: `SKILL.md`, a router an agent reads first (its front matter has the `name` and the
`description` an agent picks it by), and `references/`, one file per part of a design (`layout.md`,
`typography.md`…), with `patterns/` (how well-made products build each kind of screen, counted)
and `studies/` (what 4,983 well-made sites do, by character) beneath.

## In Ultrapaint

`pnpm -F @ultrapaint/server skills` writes the skill into the server
(`apps/server/src/skills/design.generated.ts`), and a test fails when the two differ, so run it
after an edit. Each part is a built-in skill there, in the order `apps/server/src/skills/index.ts`
gives: a project replaces or extends one with `<designsDir>/skills/<name>.md`, and the settings
turn one off.

The settings' `skills.briefing` says how a thread is told them: every part whole (`full`, the
default), each by its title and summary (`summaries`), or the router with character, hierarchy and
restraint, the agent reading every other part when it reaches it (`router`). The references are
written to the user's cache (`~/.cache/ultrapaint/skills/<version>/`), the agent sandbox lets
agents read it, and a mention of `` `references/…` `` names the file there.

Each part names principles under headings, with exact values, and ends on a "Before you finish"
table of what to look for and what fixes it. A rule lives in one part and the others leave it
there.

## Where the rules come from

Besides what the skills started with, the design evals lab: agents remake good reference
screens, a judge and a person compare the results section by section, and the changes that win
are written back here.
