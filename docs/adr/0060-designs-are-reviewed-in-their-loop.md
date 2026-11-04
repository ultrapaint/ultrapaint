# ADR 0060: Designs are reviewed inside their loop, by reviewers the person picks

Status: proposed, 2026-11-04. The timing (D5 in `docs/plans/PLAN-review-loop.md`) is measured
before the editor is built.

## Context

The design skill ends with a step asking the designing agent to have a fresh agent review each
section (6112aa4). Fresh reviewers find most of what a design gets wrong, but in a design round
Claude in the editor never started one (0 of 6 runs) while Codex always did (gap p08): a step the
agent may skip doesn't happen. A review at the end also comes after the design is built. Recall
showed that reviewers on different models find partly different problems (Grok 4.7 55/100, Opus
52/97, GPT-6.1-Sol 45/100), and the person wants to pick them, and to keep every finding so the
skill stops repeating its mistakes.

## Decision

- A design is reviewed inside its build, look and adjust loop, not after it. The designer asks
  for a review with a tool when a section is done; when a turn ends with sections edited since
  their last review, the editor reviews them and sends the findings back into the chat.
- The editor runs the reviewers, so any model can review whatever model designs: Claude, Codex,
  or Cursor's through `cursor-agent`. The person picks them, how many passes and whether reviews
  are on, the first time a design would be reviewed; it is their setting from then on.
- A reviewer is the design skill in its review role. The skill says how to review a section and
  what a finding holds, and the lab's recall reviewers read the same text.
- The designer fixes each finding or declines it with a reason.
- Every finding is logged in the project's state with its reviewer, model, skill version and what
  the designer did. In this repository a triage skill turns recurring findings into gaps.
- Whether a section is reviewed after it is built or the page at the end of the turn is decided
  by a lab round before the editor part is built.

## Consequences

- A design costs a few more agent runs per section; the setting and the passes bound it.
- Step 7 of `SKILL.md` gives way to the loop once it ships.
- The lab's rounds gain a review loop of their own, which is also how the benchmark (issue #7)
  scores a design: what a fixed panel still finds in it.
