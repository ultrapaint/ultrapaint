---
id: g83
title: A row's text held to the label column beside its action
kind: missing
status: done
found: 2026-11-19
source: the person, on the workspace screens of decisions/rows-nov19 (fx-opus-rl2 run 1)
skill: [references/kinds/settings.md]
sections: []
---

**What happened.** On the workspace settings of `fx-opus-rl2` run 1, the rows of "Data and
ownership" (Export, Transfer ownership, Delete workspace) set their text in the label column of
the form rows above, so "Removes 23 projects, 1,481 tasks and 2.4 GB of files. Recoverable for 30
days, then permanent." wraps over three lines 264px wide in a card 856px wide, with the action
alone at the far right. The other five workspace runs gave that text the row's width (587 to
671px). The person: "Why on the row-lines-2 run-1 the description is capped at that width? I
think for those you could make the columns larger?" Picture in `gaps/g83/` (the person's crop
and the full page).

**The skill now.** `references/kinds/settings.md` gives a field row its label column and its
control column; nothing says how wide the text of a row whose only control is a button is.

**Proposed.** A row whose control is one action: its text takes the row's width up to the action,
never the label column of the field rows around it.

**Test.** A candidate with the proposed line against the shipped skill, on the workspace brief, 4
runs each, Opus designing. From each render, for every row whose control is one action: the
text's width against the space from the row's start to the action. A row fails when its text
wraps onto more lines than it would take in that space. The candidate passes only when the shipped
skill fails in at least 2 of its 4 runs and the candidate in none, with no field row changed.
With fewer shipped failures the result is inconclusive (the fault was seen in 1 of 6 runs) and
the runs grow to 8 a side: then the candidate passes only when the shipped skill fails in at least
4 of 8 and the candidate in none (Fisher one-sided p ≈ 0.04); otherwise the gap stays open.

**Result.**

- `fx-opus-ar`, `fx-opus-main19`: 2026-11-19, `fresh-workspace-settings`, Opus in Claude Code
  designing: `candidates/action-rows` (the line of **Proposed**, and its Check row) 4 runs,
  against the skill on main 2 runs and `fx-opus-rl2`'s 2 (the same rule on lines). Measured from
  each render at 1440px:

  | | Runs failing the test | Text held to the label column | Text held to a 60-character measure |
  | --- | --- | --- | --- |
  | Shipped | 3 of 4 | 1 of 4 (264px, 2 to 3 lines in 620 to 675px of room) | 2 of 4 |
  | `action-rows` | 1 of 4 | 0 of 4 | 1 of 4 |

  By the test as written the candidate does not pass: it failed one run. The failures are of two
  kinds. The one the person flagged, text held to the label column, came in 1 of 4 shipped runs
  (1 of 6 with the earlier `fx-opus-sl` runs) and in no candidate run. The other is text capped
  at about 606px by a 60-character measure, wrapping one or two words with 60 to 90px of room
  left before the action. No field row changed in any candidate run: every one keeps its label
  column. Which wraps count as the fault is asked in `decisions/width-nov19`.
- `width-nov19`, decided (the person, 2026-11-19): the 60-character wrap is not a fault ("The run
  2 of the shipped is okay"); the text held to the label column beside a lone action is, and how
  to avoid it was left to the lab. Read that way, the fault came in 1 of 4 shipped runs (1 of 6
  with `fx-opus-sl`) and in none of the 4 `action-rows` runs, with no field row changed; too few
  to pass the test as written, which counted both wraps. The line is the fault's fix in so many
  words and costs two lines, so it ships on the person's eye: `references/kinds/settings.md`,
  "Settings are rows": "A row whose control is one action (Export, Transfer ownership, Delete):
  its label and line take the row's width up to the action, never the label column of the field
  rows around it.", with its Check row. A row's line capped at the reading measure passes. Done.
