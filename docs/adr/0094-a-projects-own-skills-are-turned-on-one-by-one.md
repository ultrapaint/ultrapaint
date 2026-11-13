# ADR 0094: A project's own skills are turned on one by one

Status: accepted, 2026-11-13. Amends 0048 (which skills a design thread is told).

## Context

Every design thread was told Ultrapaint's design skill and every markdown file in
`<designsDir>/skills/`, and Settings turned any of them off. People bring design skills of their
own, kept where their agents keep skills: a folder with a `SKILL.md` in `.claude/skills/`,
`.agents/skills/` (the open Agent Skills layout) or `skills/`. Ultrapaint saw none of those. The
person asked that Ultrapaint's skill stay the one default, that the project's other skills be
found and turned on one by one as the project's defaults, saved in its settings, and that a
chat's own choice of skills come later, with the chat's rework.

## Decision

**The design skill is on by default; a project's own skills are found, listed, and told only
once turned on.**

- The skills a project has (`SkillsService.list`): the files under `<designsDir>/skills/`, then
  the folders with a `SKILL.md` under `.claude/skills/`, `.agents/skills/` and `skills/`
  (`SKILL_FOLDERS`); a folder named `ultrapaint` is a copy of the shipped skill and left out. A
  skill's title and summary are its front matter's `name` and `description` (`skillFrontMatter`),
  else its first heading and paragraph. A folder's skill is told with where its files are, which
  it names from there.
- `ultrapaint.config.json` `skills.enabled` lists the project's skills that are on, by their
  file's repo-relative path (`.claude/skills/grilling/SKILL.md`); none when absent.
  `skills.disabled` keeps turning the design skill off by its name. A skill's MCP resource keeps
  its name, numbered when two share one.
- Settings › Skills: **Design skill** (Ultrapaint, with its switch, and Sent as), then **In this
  project**, every skill found with its summary, its folder, Read and its switch; with none, where
  to add one.

## Consequences

- A project whose files in `<designsDir>/skills/` were told by default tells none of them until
  they are turned on.
- What a chat is told stays the project's defaults until chats choose their own skills.
