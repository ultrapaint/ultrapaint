---
id: p14
title: The review's method told only to the editor's reviewers
kind: process
status: done
found: 2026-11-21
source: an audit of the skill's independence from the editor (thread of 2026-11-20)
skill: [SKILL.md, references/review.md]
sections: []
---

**What happened.** How a review judges and reports is written in the editor's server, not in the
skill. `REVIEWER_ROLE` (`apps/server/src/services/review/review-prompts.ts`) tells the editor's
review models:

- what takes judgement first: the hierarchy, restraint, the character, the states the request
  needs, the content;
- the scope: the request's own words are not a finding, a picture it gave decides the look, a
  system component's look is the system's, a page the request did not ask for is a `minor`
  finding at most, a fix never adds what the picture lacks or undoes a fix asked for before;
- one finding per problem, and a problem the states of one screen share given once;
- four severities, each defined (`blocker`, `major`, `minor`, `nit`), and when a page is signed
  off: no blocker or major left, a product screen held to a higher bar than a quick sketch;
- a second look checks the findings sent before and reports nothing new but a blocker.

An agent running the skill outside the editor has none of it: step 6 has it start a fresh agent
"with this skill", and the skill's review job ends on "Report each failure with the rule it breaks
(its file and its words), where it is, and the fix."

The other way round, the editor's reviewers are told the core's rules and `references/review.md`
(`toldRules`), not the skill's review job: they write no inventory first and are not sent to the
kind's file. A review with the skill is one thing outside the editor and another inside it.

**The skill now.** `SKILL.md`, "Reviewing a design": write the inventory, then check it against
`references/review.md`, the kind's file and the topic files; report each failure with its rule,
where it is and its fix.

**Proposed.** The method moves into the skill, in `references/review.md` (or the core's review
job where a line holds it): what to judge first, the scope, one finding per problem, the
severities and the sign-off, the second look. `REVIEWER_ROLE` keeps only what is the editor's: the
JSON answer and its fields, the categories and `reached`, the read-only sandbox, and how each page
is shown (its picture, its document, the checks' measures). The editor's reviewers are told the
skill's review job with the rules, so they review as an agent outside the editor does; so are the
lab's `told` reviewers, through the same `toldRules`. The lab's own section reviewer
(`evals/prompts/review-section.md`, for a round's review loop and `panel`) already reads the
version under test; its severities and sign-off become the skill's too, and it keeps the lab's
answer.

**Test.** Two measures, the candidate against the shipped skill:

- A recall round on the existing sections with told reviewers: recall of the known gaps holds or
  rises, and findings the person would reject (out of scope, added elements, severities too high)
  do not rise.
- A fresh-brief design round outside the editor, the designer having a fresh agent review each
  section with the skill (step 6): the tells and the faults left at the end against the shipped
  skill's runs.

`toldRules` now tells the core's review job to every version, the shipped one included: a told
round from before this change is not a baseline. Run the shipped skill's side again with it, and
compare that side with its last told round to see what telling the job alone does.

**Result.**
- `up88-told`: 2026-11-22, told reviewers, both versions under this change's `toldRules` (the core's
  review job told), 17 sections × 3 runs (Opus reviewing and judging, effort high;
  runs/up88-told/report.md). There `up88-shipped` is main's skill and `shipped` this change, at
  8ddc22d9. Caught: main 104/168 (62%, +25 partly), this change 98/166 (59%, +24 partly), −3
  points (−9 to +3): recall holds. Findings no gap matched, per review: 11.9 against 9.9, unrated
  (`recall --rate` would say whether fewer is less noise).
- `up88-names`: 2026-11-22, reviewers that open the skill: this change 113/165 (68%) against
  main's 117/168 (70%), −1 point (−7 to +4); findings no gap matched 12.3 against 13.8 per review.
  The rest of the round is p13's.
- `up88-fx-shipped` against `up88-fx`: 2026-11-22, fresh briefs outside the editor, main's skill
  against this change (p13's line has the tells and the blind pairwise). A designer started a
  fresh agent to review its sections in 1 run of 8 with main's skill and 2 of 8 with this one, so
  the method reaches few designs made outside the editor: p08, reopened.
- Decision of 2026-11-22: shipped with UP-88's second stage (#90).
