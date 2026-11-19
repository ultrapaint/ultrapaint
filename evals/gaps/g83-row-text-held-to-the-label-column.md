---
id: g83
title: A row's text held to the label column beside its action
kind: missing
status: open
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

**Test.** The workspace brief, 2 runs, against the shipped skill: the width of each action row's
text from the render. A fault seen in 1 of 6 runs; it may need more runs to tell.
