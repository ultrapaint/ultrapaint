---
name: up-setup
description: Proposes a value for every setting the installed up-* skills declare, in one table to accept or amend, and saves them. Use to configure the skills up front, or to change a setting.
disable-model-invocation: true
metadata:
  pack: epicparty/skills
  version: 0.2.0
---

# Setup

Every `up-*` skill asks for a **setting** the first time it needs one. Setup settles them all up front, so later runs ask nothing, and it asks as little as it can: it works out a recommended value for every setting first, shows them all in one table with the reason for each, and asks one question — accept the table, or change the rows you disagree with.

Setup owns no setting. Each skill declares its own in its `## Settings` section — the steps that find a setting, then one `###` heading per setting with its topic, its question and its options. Setup reads those headings, so a newly installed skill's settings reach setup with no edit here.

With no argument, setup proposes every **unset** setting. Given a skill or a setting by name, it proposes that one again even when it is set: that is how a user changes an answer.

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

Two skills that declare the same topic and heading share one setting: propose it once. Where their questions or options differ, name both skills and show the difference under its row in § 5, because one of them has drifted.

Compare the numbered steps at the top of each `## Settings` section that has them, too. They are copies of one procedure, so each skill runs alone. A copy that differs from the others is drift: name the skill and the step in the report.

Done when every setting is listed with its topic, its heading and the skills that declare it.

## 3. Find the settings home

The `## Agent skills` block of the root `AGENTS.md` — or `CLAUDE.md`, whichever the project has — names where `up-*` settings live and in what form. Read it; ask nothing yet.

With no such line, the home is the table's first row in § 5, recommending **`docs/agents/<topic>.md`** — one Markdown file per topic, one `##` heading per setting, named as the setting — written as one line in that block: `` `up-*` settings: `docs/agents/<topic>.md`, one heading per setting. `` Its other options are **One file**, at a path the user names, and **Another form**, as the user describes it. With neither file present, the row also creates `AGENTS.md`, which most agents read.

Done when the settings home is read, or proposed as a row.

## 4. Recommend

Work out a value for every setting in scope before asking anything. In scope is every unset setting, or the ones the user named. Read each at the settings home first: a set setting the user did not name keeps its value and gets no row.

For each setting in scope:

- **Pick one of its options**, by its own name, the way the setting's **Recommend when** column and the text under its table say. A recommendation that reads the repo reads it now: `gh`, the CI workflows, `package.json` and the lockfile, the agent files, `git log`.
- **Fill in its follow-up** so the value can be written as it stands — the issue prefix and the board's status names, each label role and axis, one row per test level, the commands in order. A follow-up left as "to be decided" turns the row back into a question.
- **Keep the reason**: the fact that decided it — a file, a command's output, a count — in a few words.
- **Settle the ones it shapes after it.** **Tracker** comes first: a setting that `/up` `## Settings` or `## Working rules` rules out — under **Tracker** at **None**, or in a repo with no remote — gets no row and goes to the report as ruled out, with its reason.
- **With no evidence either way**, recommend the option that commits the project least — the one the table marks as the default, or **None** — and say so in the reason. Mark a row `— ask` only when its value is a fact only the user has and no option's default covers it.

An **action** is a step a setting attaches to its answer that changes something outside the settings home — **Labels** creating the labels the tracker lacks, on GitHub. Work it out with its setting and give it its own row under that setting, with what it does and to what: `create 3 labels: needs-info, needs-grilling, epic`. With **Labels** already set and out of scope, compare the labels it names with the tracker's all the same: a missing one is an action row of its own. Nothing outward-facing runs except an action row the user accepts.

Done when every setting in scope has a value and a reason, or is marked `— ask` or ruled out, and every action is a row.

## 5. Review

Print one table: every row numbered, grouped under the topic each value is written to, the home row first. **Recommended** names the option as its skill declares it, then its follow-up; **Because** is the reason from § 4:

```
 #   Setting          Recommended                                  Because
     agent skills
 1   Settings home    docs/agents/<topic>.md                       AGENTS.md has no Agent skills block
     issue-tracker
 2   Tracker          GitHub Issues — prefix UP-, no board          gh repo view finds the repo; 41 of the last 200 commits name UP-<n>; no linked project
 3   Labels           The defaults                                  the tracker has only GitHub's default labels
 3a    action         create 7 labels: needs-triage, needs-info, …  Labels names them; the tracker lacks them
     git
 4   Merge strategy   Squash                                        the repo allows only squash merges
     deploy
 5   Deploy           None                                          no workflow deploys on a push to main
```

Under the table, one line each for the settings already set and left as they are, and the ones ruled out. Then ask one question, **Accept all** first:

- **Accept all** — write every row as shown, and run every action row.
- **Change some** — the user names rows by number or setting, each with its new value: `3: None; 5: A deploy workflow, deploy.yml on push to main; skip 4`. A value is an option by its name, a new follow-up (`2: no prefix`), or `skip`. Write it as given. Only a change too vague to write — `Labels: different` — becomes a question: that setting's question and options, recommendation first.
- **Discuss a row** — show that setting's question, every option with its **Recommend when**, and what § 4 found, then take the user's answer.

**Skip** is always a value: a skipped setting stays unset, and its skill asks for it when it first needs it. Dropping an action row leaves its setting's value standing.

When a change alters other rows — **Tracker** at **None** rules out **Labels** and its action — settle those again, print the table once more with the changed rows marked, and ask the same one question. Otherwise move on. After the accept, ask each `— ask` row, one at a time, as its skill words it.

Done when the user has accepted the table, with or without changes, and every `— ask` row is answered or skipped.

## 6. Write

In one pass, in the table's order: record the settings home if row 1 proposed it, write every accepted value at the settings home in the form it names, then run every accepted action — on GitHub, `gh label create` for each missing label. An action that fails is reported with its output, and the rest still run.

Done when every accepted value is written, and every accepted action has run or failed.

## 7. Report

The table again, with the values now set and no **Because** column, then:

- **Actions** — each one run, and its result.
- **Skipped** — each one, and the skill that will ask for it later.
- **Ruled out** — each one, and the answer or the fact that ruled it out.
- **Drift** — each difference § 2 found, with the skills it names.
- **Missing labels** — with **Labels** set and its action dropped or failed, each label the tracker still lacks.
- Where the answers live, and that a user can edit them there or run `/up-setup <setting>` to change one.

Done when the user can see every setting's value without opening a file.

## Guardrails

- **The skill's own words decide.** A recommendation is one of the setting's options, named as its skill declares it, and a question setup asks is the skill's question with its options. A setting setup words differently is a second definition of it.
- **Answers are the user's.** Setup writes nothing and runs no action before the user accepts the table; an accepted row is the user's answer.
- **One question, not one per setting.** Setup asks the review question, and only what a vague change or a `— ask` row needs after it. Each other skill still asks for a missing setting on its own, one at a time, when it first needs it.
