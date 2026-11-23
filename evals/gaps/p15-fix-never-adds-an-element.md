---
id: p15
title: A review's fix may not add a control the request allows
kind: process
status: open
found: 2026-11-23
source: CodeRabbit's review of PR #90 (UP-88), which moved the rule into the skill
skill: [references/review.md]
sections: []
---

**What happened.** When the review's method moved from the editor's reviewer prompt into the
skill (ADR 0111), a code review read its scope rule as too strict. A fix never adds an element
the picture does not have, even one the request allows. Its example was a dialog drawn with no
way to cancel: a reviewer can report that, but its fix cannot add the Cancel button. No design
has been seen going wrong this way yet.

**The skill now.** `references/review.md`, Judging: "A fix never adds an element the picture does
not have, and never undoes a fix asked for before."

**Proposed.** A fix may add a control the request allows when the design lacks one it needs to do
its job (a way to cancel, to go back, to close). It still adds no element the request did not ask
for, and still never undoes an earlier fix.

**Test.** A recall round on sections where a needed control is missing, with a gap naming it:
whether the candidate's reviewers give the fix that adds it. Also check whether unmatched
findings grow on the other sections, which would mean the rule is letting reviewers ask for more
than the request.

**Result.**
