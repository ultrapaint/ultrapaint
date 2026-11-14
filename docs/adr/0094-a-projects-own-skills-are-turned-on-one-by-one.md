# ADR 0094: A project's own skills are turned on one by one, and the designs hold no skills

Status: accepted, 2026-11-13. Amends 0048 (which skills a design thread is told).

## Context

Every design thread was told Ultrapaint's design skill and every markdown file in
`<designsDir>/skills/`, and Settings turned any of them off. People bring design skills of their
own, kept where their agents keep skills: a folder with a `SKILL.md` in `.claude/skills/`,
`.agents/skills/` (the open Agent Skills layout) or `skills/`. Ultrapaint saw none of those. The
person asked that Ultrapaint's skill stay the one default, that the project's other skills be
found and turned on one by one as the project's defaults, saved in its settings, and that a
chat's own choice of skills come later, with the chat's rework. They also asked that the designs
directory hold screens only, never skills, that Ultrapaint's skill be the app's own and never
read from the repository, and that Settings offer it to agents outside the tool.

## Decision

**The design skill is the tool's own and on by default; a project's own skills are found in its
agents' skill folders, listed, and told only once turned on. The designs directory holds no
skills.**

- The design skill is built into the tool (`skills/ultrapaint/`, generated into the server) and
  told from there whether or not a copy is in the repository; `skills.disabled: ["ultrapaint"]`
  turns it off.
- A project's own skills (`SkillsService.list`): the folders with a `SKILL.md` under
  `.claude/skills/`, `.agents/skills/` and `skills/` (`SKILL_FOLDERS`); a folder named
  `ultrapaint` is a copy of the design skill and left out, and folders that are one on disk (a
  skills pack installed in `.agents/skills/`, linked into `.claude/skills/`) are listed once, by
  the first in that order, the others its `aliases`: a setting or a chat's choice naming any of
  them names the skill. A skill's title and summary are its
  front matter's `name` and `description` (`skillFrontMatter`), else its first heading and
  paragraph. A folder's skill is told with where its files are, which it names from there. Files
  in `<designsDir>/skills/` are no skills: the designs directory holds designs only.
- `ultrapaint.config.json` `skills.enabled` lists the project's skills that are on, by their
  `SKILL.md`'s repo-relative path (`.claude/skills/grilling/SKILL.md`); none when absent. A
  skill's MCP resource keeps its folder's name, numbered when two share one.
- **Outside the tool**, Settings offers the design skill two ways: the open skills installer's
  command (`SKILL_INSTALL_COMMAND`, `npx skills add ultrapaint/ultrapaint`), and **Save in this
  repository** (`skills.install`), which writes its `SKILL.md`, with its front matter, and its
  `references/` into `.claude/skills/ultrapaint/` (for Claude Code) or `.agents/skills/ultrapaint/`
  (for other agents), replacing a copy there whole. `SkillList.installed` says where copies are.
- Settings › Skills: **Design skill** (Ultrapaint, its switch, Sent as), **In this project**
  (every skill found with its summary, its folder, Read and its switch; with none, where one
  goes), **Use it outside Ultrapaint** (Install, Save in this repository).

## Consequences

- A project's files in `<designsDir>/skills/` are told no more; moved into a skill folder, they
  are listed and turned on there.
- The designs' watcher has no `skill` kind; the list is read again when Settings opens it and
  sent after a save.
- What a chat is told stays the project's defaults until chats choose their own skills.
