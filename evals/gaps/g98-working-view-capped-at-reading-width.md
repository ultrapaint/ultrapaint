---
id: g98
title: A working view in an app shell capped at the reading width
kind: missed
status: open
found: 2026-11-12
source: the person's design chats on a client app (dashboard, an object's overview, a questionnaire step), usage logs of 2026-11-10 → 25
skill: [SKILL.md, references/layout.md, references/review.md]
sections: []
---

**What happened.** A review model's first major on a client app's dashboard was "Main column has
no width cap", citing the Layout rule. The designer then put the dashboard, an object's overview
and a questionnaire step in the reading container (720px), left-aligned in a wide content panel.
The person reversed it twice the same day: "The content inside this section should take the full
width, not the reading width. It contains text, yes, but it's not a blog page or a wall of text.
We should also mark this as a gap", then "Every other page content should always take full width
inside the" content container. The designer itself foresaw the rest: "It will keep sending future
designs back to 720 px until it's updated." Review models raised a width ceiling again in 5 later
sessions of the same project.

**The skill now.** `SKILL.md`, Layout: "Width has a ceiling: a product's main column takes a
container token (about `768px` for prose and forms, a form stopping at its longest comfortable
field)". The line names prose and forms, but read as "a product's main column", the agent and the
reviewer applied it to every working view. g82 (done) fixed the same pull for settings only.

**Proposed.** Candidate for the Layout line: "Width has a ceiling where text runs: a paragraph caps
at about `60ch`, a form at its longest comfortable field, an article or a lone form sits in the
reading container (about `768px`). A working view in an app shell (a dashboard, an object's
overview, a list, a step of a flow) fills its content area; a row's action is brought to its text
by the row's own layout, not by narrowing the page." With the matching row in `references/review.md`,
so a reviewer never asks for a cap on a working view.

**Test.** Fresh briefs for app screens with a sidebar shell (a dashboard, a record's overview, a
step of a flow), 2 runs each at Opus, shipped against the candidate: the main column's width at 1440
and 1920 from the render, and whether the review raises a width cap. Prose and form briefs as the
control: they keep their ceiling.

**Result.**
