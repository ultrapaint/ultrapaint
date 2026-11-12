---
id: p01
title: The brief replaced the references
kind: process
status: wontfix
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [SKILL.md]
sections: []
---

**What happened.** The lead compressed the skill into a one-page brief for the six agents, which
turned judgment into recipes:
- "Empty states: a muted icon, a one-line title, one muted sentence, one action".
- "Rows 28px, panel padding 8px".

Where the brief and the references differed, the agents followed the brief. G1 came straight
from it.

**Proposed.** The skill says how to hand design work to other agents: the brief points to the
references and `DESIGN.md`, and never restates a rule as a recipe without its condition.

**Test.** The same task briefed both ways, with the gaps counted.

**Result.**
- Decision of 2026-11-04 (made by the agent, as the person asked): stays open: recall's reviewer is briefed by the lab, not by another agent, so only a design round, a task briefed both ways, can measure it.
- `design-after-codex` (2026-11-04): Codex briefed a reviewer subagent in every run, but the trace keeps the call, not the brief, so how it briefed is not measured. The round's traces need the brief to test this.
- 12 November: closed by ADR 0082. Fresh briefs have no reference behind them by design, and replication, which keeps a reference, is its own track.
