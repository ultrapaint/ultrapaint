---
id: p08
title: The review step skipped when an agent could be started
kind: process
status: open
found: 2026-11-04
source: design round `design-after` (three product screens remade from a picture, skill at 1d8977c)
skill: [SKILL.md]
sections: []
---

**What happened.** In all six runs of `design-after`, Claude in the editor's thread finished
without a fresh agent reviewing its sections. Four of them said so in their last message ("I
didn't have a fresh agent review each section"). The editor's Claude agent has the subagent tool
(the ACP adapter disables only AskUserQuestion), so step 7's "when you can start another agent"
held. Codex, with the same skill, started a reviewer in all six of its runs (`design-after-codex`).

**The skill now.** `SKILL.md` step 7: "When you can start another agent, have a fresh one review
each section from a crop at 2× … with this skill, and fix what it finds."

**Proposed.** To try: make the review part of finishing rather than a step after it. Step 6 names
the reviewer's report as what the last message cites, or the editor starts the reviewer itself
when a design thread ends.

**Test.** A design round on the same references, with the subagent calls counted in the traces and
the sections' findings compared.

**Result.**
