# Design gaps

A gap is a place where a design made with the design skill (`skills/ultrapaint/`) went wrong, as
a person found it when they corrected the design, with how the skill could have prevented it.
Each gap is one file here. `pnpm evals gaps` lists them with their kind and status.

Gaps are kept so that the skill changes only on evidence. A rule written from one correction may
not hold for the next design, and every rule costs every agent attention. So a gap waits here
until the lab has shown that a change to the skill makes agents catch it, and the person decides.

## Kinds and statuses

| Kind | Means |
| --- | --- |
| `missing` | The skill has no rule for it. |
| `missed` | The rule exists and was not applied. |
| `process` | It is about how the skill is run, not what it says. |

| Status | Means |
| --- | --- |
| `open` | Recorded, not yet measured. |
| `testing` | The lab has measured it; its results are under **Result.** |
| `done` | A change to the skill closed it. The change names the gap. |
| `wontfix` | Kept as a record, with the reason in its text. |

## A gap's file

`g` + a number for something seen in a design (`g10-actions-that-cant-act.md`); `p` + a number for
how the skill was run (`p03-…`). The title in kebab case follows the number.

```md
---
id: g10
title: Actions offered where they can't act
kind: missing
status: open
found: 2026-11-03
source: the new chat's starters, editor redesign (branch redesign)
skill: [references/states.md, references/usability.md]
sections: [chat-starters]
---

**What happened.** What the person found, and where.

**The skill now.** What the skill already says, quoted from its file.

**Proposed.** The rule or check to try.

**Test.** How the lab tells whether the change works.

**Result.**
```

- `skill`: the skill's files it concerns, from `skills/ultrapaint/`.
- `sections`: the sections `pnpm evals recall` reviews for it. A `g` gap is the judge's ground
  truth for those sections; a `p` gap is measured by what is caught of the `g` gaps in its
  sections. Leave it empty when recall can't measure the gap.

## Pictures and sections

Pictures stay outside git, in the evals' data directory (`~/Code/ultrapaint-data`):

- `gaps/<id>/`: the person's screenshots of what they corrected.
- `gaps/sections/<section>/`: what a reviewer is shown, named once for every gap that shares it:
  - `section.json`: its `name`;
  - `where`: what it is, in words that don't say what is wrong;
  - `commit`;
  - `pictures`: each with what it `shows`;
  - `code`;
  - `pictures/`: dark and light, with `@2x` crops of the section;
  - `code/`: the files at that commit, `DESIGN.md` first.

  A section that no gap names is held out: what reviewers find there goes to the person to rate.
- `gaps/capture/`: the scripts that took them.

## Adding a gap

1. After a person corrects a design made with the skill, add a file here, status `open`. Leave
   `skills/ultrapaint/` as it is. What review models find while the person keeps findings comes
   here too, through `pnpm evals triage` (ADR 0066): the problems that recur, drafted as gaps the
   person keeps in a deck.
2. Put their screenshots in `gaps/<id>/`. If recall can measure the gap, capture the section as
   it was before the fix into `gaps/sections/<section>/` and name the section in `sections`.
3. Write a candidate: copies of the skill's files with the proposed change, in
   `candidates/<fix>/` of the data directory. `SKILL.md` is the router; every other file is a
   reference by its path under `references/` (`states.md`, `patterns/canvas-tools.md`).
4. Run `pnpm evals recall <round> --skills built-in,candidates/<fix>`. The run writes its line
   under **Result.** in each gap it measured, shipped against candidate, and sets an `open` gap
   to `testing`. Its report, with the findings no gap matched, is in `runs/<round>/report.md`.
5. Once the person accepts a change into the skill, the change names the gaps it closes, and
   they become `done`.
