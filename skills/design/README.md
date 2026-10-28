# Design skills

What ultrapaint teaches its agents about designing interfaces, as a set of skills any agent can
use. Each folder is one skill in the Agent Skills layout: `SKILL.md`, a short front matter (its
`name` and a `description` an agent picks it by) over the skill itself, and, for knowledge read
only when it is needed, a `references/` folder.

## In ultrapaint

These files are the built-in skills: `pnpm -F @ultrapaint/server skills` writes them into the
server (`apps/server/src/skills/design.generated.ts`), and a test fails when the two differ, so
run it after an edit. Agents are told every skill at once in each thread's briefing, in the
order `apps/server/src/skills/index.ts` gives; a project still replaces or extends one with
`<designsDir>/skills/<name>.md`.

Each skill names principles under headings, with exact values, and ends on a "Before you
finish" table of what to look for and what fixes it. A rule lives in one skill and the others
leave it there.

## Elsewhere

Copy or link the folders where an agent looks for skills, for Claude Code:

```sh
ln -s "$PWD"/skills/design/* ~/.claude/skills/
```

## Where the rules come from

Besides what the skills started with, the design evals lab: agents remake good reference
screens, a judge and a person compare the results section by section, and the changes that win
are written back here.
