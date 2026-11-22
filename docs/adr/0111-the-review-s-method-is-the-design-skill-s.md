# ADR 0111: The review's method is the design skill's

Status: accepted, 2026-11-22, measured on gap p14 (recall held). Amends 0063 (what a review
model is told) and 0077 (what a told reviewer is told).

## Context

How a review judges was written in the editor's server, in the review model's role
(`REVIEWER_ROLE`): what to judge first, the request's scope (its words and picture are not
findings, an unasked page is minor at most, a fix never adds what the picture lacks), one finding
per problem, four severities with what each means, when a page is signed off, and the second look.
The skill's own review job ended on "report each failure with the rule it breaks, where it is, and
the fix". An agent running the skill outside the editor, or the fresh reviewer its step 6 starts,
reviewed with none of it; the editor's reviewers, told the core's rules and the review rows
(0077), were never told the skill's review job. A review with the skill was one thing inside the
editor and another out of it.

## Decision

- **The method is the skill's.** `references/review.md` opens on it, before its rows: what takes
  judgement first, within the request, within its scope, one finding per problem, the severities
  (blocker, major, minor, nit) and the sign-off, a second look. The core's review job judges and
  reports as it says, with a severity and whether the design is done.
- **A told reviewer is told the review job.** `toldRules` gives the core's rules, its `## Reviewing
  a design`, saying the reviewer opens no file, and the whole of `review.md`. The editor's review
  models and the lab's `told` reviewers get the same words, as before.
- **The role keeps the editor's.** `REVIEWER_ROLE` keeps the reviewer's sandbox, that a screen's
  states are its pages, the JSON answer and its fields, the categories and `reached`; a severity
  and a sign-off are "as the skill's review defines them". The second look's prompt keeps its
  protocol (the findings sent, by title).
- **The lab's section reviewer takes them from the skill too.** `evals/prompts/review-section.md`
  already has its reviewer read the version under test; its severities and its sign-off are now
  "as the skill's review defines them", and it keeps the lab's answer and its fields. A panel
  reviews every round it compares with one checkout's skill, so its rounds share one ruler; panel
  scores from before the change are not compared with those after it. A skill from before this
  change defines no severity, and a lab review loop is not run on one.

## Consequences

- An agent outside the editor reviews as the editor's review models do: same job, same scope, same
  severities.
- A review prompt grows by the core's review job, about 1,200 characters, and `review.md` by its
  method, about 3,000.
- A change to how reviews judge is a change to the skill, through a gap, not to the server.
