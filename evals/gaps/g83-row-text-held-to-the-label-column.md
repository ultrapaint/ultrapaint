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

**Test.** A candidate with the proposed line against the shipped skill, on the workspace brief, 4
runs each, Opus designing. From each render, for every row whose control is one action: the
text's width against the space from the row's start to the action. A row fails when its text
wraps while it has under three quarters of that space. The candidate passes only when the shipped
skill fails in at least 2 of its 4 runs and the candidate in none, with no field row changed.
With fewer shipped failures the result is inconclusive (the fault was seen in 1 of 6 runs), the
runs grow to 8 a side or the gap stays open.
