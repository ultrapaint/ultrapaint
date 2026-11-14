---
name: up-setup
description: Walks every setting the installed up-* skills declare and saves the project's answers. Use to configure the skills up front, or to change a setting.
disable-model-invocation: true
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# Setup

Every `up-*` skill asks for a **setting** the first time it needs one. Setup asks them all up front, in one sitting, so later runs ask nothing.

Setup owns no setting. Each skill declares its own in its `## Settings` section — the steps that find a setting, then one `###` heading per setting with its topic, its question and its options. Setup reads those headings, so a newly installed skill's settings reach setup with no edit here.

With no argument, setup asks every **unset** setting. Given a skill or a setting by name, it asks that one again even when it is set: that is how a user changes an answer.

## 1. Find the skills

List the skills of this pack installed for this project and for the user, following symlinks. A pack skill carries `pack: epicparty/skills` under `metadata` in its frontmatter, whatever prefix the project installed it with:

```sh
find -L .agents/skills .claude/skills ~/.agents/skills ~/.claude/skills \
  -maxdepth 2 -name SKILL.md 2>/dev/null |
  while read -r f; do
    grep -Eq '^[[:space:]]+pack: epicparty/skills[[:space:]]*$' "$f" &&
      echo "$(basename "$(dirname "$f")") $(realpath "$f")"
  done |
  sort -u -k2,2
```

Where the shell cannot run the pipeline, search the same folders for that line with your search tool. Each line is a skill's installed name and its file. A skill reached twice — through `.claude/skills` and `.agents/skills`, say — resolves to one file and counts once.

Done when every installed skill of the pack is listed once.

## 2. Collect the settings

Read each skill's `## Settings` section. A skill without one has nothing to ask, and neither has a skill whose section only names settings another skill defines — `/up-to-story`, `/up-triage` and `/up-to-pr` read only the ones `/up` defines. Every `###` heading under a section is one setting, keyed by its **topic** and its heading.

Two skills that declare the same topic and heading share one setting: ask it once. Where their questions or options differ, name both skills and show the difference before asking, because one of them has drifted.

Compare the numbered steps at the top of each `## Settings` section that has them, too. They are copies of one procedure, so each skill runs alone. A copy that differs from the others is drift: name the skill and the step in the report.

Done when every setting is listed with its topic, its heading and the skills that declare it.

## 3. Find the settings home

The `## Agent skills` block of the root `AGENTS.md` — or `CLAUDE.md`, whichever the project has — names where `up-*` settings live and in what form. With neither file present, first ask which to create, recommending `AGENTS.md`, which most agents read. With no such line, this is the first question, the default first:

- **`docs/agents/<topic>.md`** (default) — one Markdown file per topic, one `##` heading per setting, named as the setting. Other headings in the file are the project's own notes.
- **One file** — at a path the user names.
- **Another form** — as the user describes it.

Write the answer as one line in that block, creating the block when it is missing — for the default, `` `up-*` settings: `docs/agents/<topic>.md`, one heading per setting. ``

Done when the settings home is named and recorded.

## 4. Show what is set

Read every setting at the settings home — the heading named as the setting, in its topic's file — then print one table before asking anything. **Skill** is the skill that declares the setting:

```
Skill        Topic     Setting      Value
up-research  research  Destination  GitHub Discussion, category Research
up-upgrade   validation  Full gate  — unset
```

With **Labels** set, compare the labels it names with the tracker's, and name any missing one in the report.

Done when every setting has a row and a value or `— unset`.

## 5. Ask

Take the settings in scope — every unset one, or the one the user named — grouped by skill. Ask **one at a time**, as the skill that declares it would:

- Its question, and its options with the recommended one first. Settle the recommendation the way the setting's table says — a recommendation that reads the repo, reads it now.
- The follow-up the chosen option needs.
- A setting that `/up` `## Settings` or `## Working rules` rules out — under **Tracker** at **None**, or in a repo with no remote — is not asked. List each in the report as ruled out, with its reason.
- **Skip** is always an answer. A skipped setting stays unset, and its skill asks for it when it first needs it.

Write each answer at the settings home as soon as it is given, in the form the home names, then run any step the setting attaches to its answer — **Labels** offers to create the labels the tracker lacks. An interrupted setup then keeps every answer already given.

Done when every setting in scope is answered or skipped.

## 6. Report

The table from § 4 again, with the values now set, then:

- **Skipped** — each one, and the skill that will ask for it later.
- **Ruled out** — each one, and the answer or the fact that ruled it out.
- **Drift** — each difference § 2 found, with the skills it names.
- Where the answers live, and that a user can edit them there or run `/up-setup <setting>` to change one.

Done when the user can see every setting's value without opening a file.

## Guardrails

- **The skill's own words decide.** Ask each question and offer each option exactly as its skill declares them. A setting setup words differently is a second definition of it.
- **Answers are the user's.** A recommendation is offered, never written unasked.
