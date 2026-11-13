# Ultrapaint

What Ultrapaint teaches agents about designing interfaces and their design systems, as one skill
in the Agent Skills layout (ADR 0069). It is written for any agent building any web interface:
it installs as it is in `.agents/skills/` or `.claude/skills/`. This README does not ship with it.

## Layout

`SKILL.md` is the core, the one file always read: the steps of the four jobs (a screen or page
with the design system it has, reviewing one, making the design system, writing only the words), every rule
that bears on most screens as one line with its value, and the table of kinds. Its front matter
has the `name` and the `description` an agent picks it by, under 220 characters.

`references/` holds what a line cannot, each file named by the core, one level deep:

- `kinds/`: a product's screens (dialog, settings, table, dashboard, form, navigation,
  feedback), opened at step 2 by the screen's kind, each naming under its title the topic files
  it is opened with;
- `pages/`: public pages (landing, shop, portfolio, editorial, title);
- topic files (`character.md`, `layout.md`, `typography.md`, `color.md`, `surfaces.md`,
  `iconography.md`, `motion.md`, `picture.md`, `components.md`, `states.md`, `usability.md`,
  `accessibility.md`), opened with a kind's file, when the core's line says, and at the check
  for every concern the screen has;
- `system/` (foundations, components, extract, figma) and `words/` (voice, interface, pages).

A file never repeats a core line; it adds anatomy, values, recipes and reasons, and ends on a
check table of what it adds. The skill speaks the web's terms, with no markers and none of the
editor's words: the briefing's `skillTerms` says them in the editor (`textStyle`, `"$name"`,
`at`, its tools).

## In Ultrapaint

`pnpm -F @ultrapaint/server skills` writes the skill into the server
(`apps/server/src/skills/design.generated.ts`), and a test fails when the two differ, so run it
after an edit. It is one built-in skill, `ultrapaint`, turned off with
`skills.disabled: ["ultrapaint"]`; a project's own skill folders turned on in Settings are told
after it (ADR 0094). Settings also install it for agents outside the tool. `skills.briefing`: `router` (the default) tells the core, `full` the core and every reference,
`summaries` one line. The whole skill is written to `~/.cache/ultrapaint/skills/<hash>/`, which
the agent sandbox lets agents read, with each `references/…` mention named there; MCP clients
read `skill://ultrapaint/SKILL.md` and `skill://ultrapaint/references/<path>`.

The review's categories name concerns; `CATEGORY_FILES` in `packages/contracts/src/review.ts`
says which file holds each.

## Where the rules come from

A change starts from a gap in `evals/gaps/`, what a person found wrong in a design made with the
skill. `pnpm evals recall --skills candidates/<fix>` lays a candidate over the skill, each file at
its path, and measures it against the shipped one; a design round tries a candidate from a
worktree through `ULTRAPAINT_CHECKOUT` (`evals/README.md`). A change that lands names the gaps it
closes, and their status becomes `done`.

A rule holds for any product, never for one page. It describes the device, not where it was seen:
the skill never names a company, product, site, library or person from the lab's references or
corpus. Faces, icon packages and tools the agent is told to use (Inter, Lucide, Figma) are named
because they are instructions, not sources.

