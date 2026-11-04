# ADR 0060: Designs are reviewed inside their loop, by reviewers the person picks

Status: proposed, 2026-11-04; amended the same day with the council's score, goal and findings
log. The timing (D5 in `docs/plans/PLAN-review-loop.md`) is measured before the editor is built.

## Context

The design skill ends with a step asking the designing agent to have a fresh agent review each
section (6112aa4). Fresh reviewers find most of what a design gets wrong, but in a design round
Claude in the editor never started one (0 of 6 runs) while Codex always did (gap p08): a step the
agent may skip doesn't happen. A review at the end also comes after the design is built. Recall
showed that reviewers on different models find partly different problems (Grok 4.7 55/100, Opus
52/97, GPT-6.1-Sol 45/100), and the person wants to pick them, and to keep every finding so the
skill stops repeating its mistakes.

## Decision

- A design is reviewed inside its build, look and adjust loop, not after it. When a turn ends
  with sections edited since their last review, they are reviewed and the findings go back into
  the chat. A designer reviewing section by section ends its turn after each section, so no
  review tool is needed.
- The **council** is the set of reviewers, any models: Claude, Codex, or Cursor's through
  `cursor-agent`. They are started by whatever runs the designer (the editor, T3 Code's
  delegation, Claude Code's subagents or the CLIs of the others), so any model reviews whatever
  model designs. When the person names none, we pick: the strongest model of each provider that
  can be reached. Their choice is kept per user, per project and per run, the run's winning.
- A reviewer **only looks**: it reads files and pictures and changes nothing. The designer fixes
  each finding or declines it with a reason.
- A reviewer is the design skill in its review role. Each finding names its **category** (one of
  the skill's references), its **severity** and the rule it breaks, or none; with the categories
  the section has and its **sign-off** (good enough for what was asked, or what is left).
- Each reviewer is **scored out of 100**, overall and per category, from its own findings, by
  code (contracts' `review`): a category is 100 less its findings' cost, a section the mean of its
  categories, a page the mean of its sections. The council has no score of its own. A reviewer
  that gave no review has **no score**, never a guessed one, and doesn't hold the loop.
- A **goal** says when the loop stops. A score asked ("90") holds every reviewer to it, unless a
  reviewer is given its own target or only advises; floors hold a category up. With no score
  asked, each reviewer judges from the request what is good enough and the loop runs until every
  reviewer signs off. A cap on rounds (6), on rounds without gain, and on budget ends a loop that
  isn't converging, and the best round is kept.
- The **findings log** is opt-in: the findings, with their category, the rule cited, the skill
  version and what the designer did, go to `~/.ultrapaint/findings/<project>.jsonl`, outside
  every repository, for triage to turn recurring ones into gaps (issue #8).
- The review is at the end of each turn by default. Whether section by section does better is
  decided by a lab round before the editor part is built.

## Consequences

- A design costs a few more agent runs per section; the council's size, the goal and its caps
  bound it.
- Step 7 of `SKILL.md` gives way to the loop once it ships.
- The lab's rounds gain a review loop of their own, which is also how the benchmark (issue #7)
  scores a design: each panel model's score, and what the panel still finds in it.
- Skill rules come in from the findings log through triage (issue #8) and go out when the models
  follow them without the skill (issue #9).
