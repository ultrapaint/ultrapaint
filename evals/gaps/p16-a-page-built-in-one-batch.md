---
id: p16
title: A page built in one batch shows the person nothing until it is done
kind: process
status: open
found: 2026-11-23
source: the research note on another canvas tool's agent tools, decided with the person in deck cqyvk87f1a
skill: []
sections: []
---

**What happened.** An agent designing a page often sends most of it in one or two
`apply_operations` calls. The person watching the canvas sees nothing for minutes, then a whole
page. Another canvas tool's MCP makes the opposite its first rule: one visual piece per write
(a header, one row of a list, a button bar), so the person sees the page build every few seconds
and can stop a wrong direction early. The research is in
`~/Code/ultrapaint-data/research/2026-11-23-reference-canvas-tool-inspiration.md`. The person
asked for it to be tried in the lab before anything changes (2026-11-23).

**The skill now.** Nothing: the design skill names no editor tool (ADR 0110), so this can't be
one of its rules. The agents' briefing (`apps/server/src/services/threads/briefing.ts`) says
"Changes land on the canvas as you make them, so make them one step at a time rather than
rewriting a page wholesale", and the design chat's plan is "Outline", then one "Build
<section>" per section (ADR 0063, 0095). Neither says how much one call should hold.

**Proposed.** A briefing line for design threads: build a page one visual piece per
`apply_operations` call (a section's frame, then its header, then each row or group of
controls), never a whole section in one call, and look with `get_screenshot` once a section is
whole rather than after every call.

**Test.** A round on fresh briefs: the candidate briefing in a worktree run with
`ULTRAPAINT_CHECKOUT` (`evals/README.md`, "A candidate in a round"), against the shipped
briefing on the same briefs. It wins if:

- the pairwise design score holds or improves;
- the median `apply_operations` calls per run rises, counted from each run's `trace.md` (it
  names each tool call by its title);
- the median operations per call falls. `trace.md` keeps no call's input, so running the round
  first adds a count of each `apply_operations` call's `ops` to the run's info in
  `evals/src/generate.ts` (`infoOf`), beside `mcpCalls`;
- time and tokens per run rise by no more than 15%.

The tells (g53–g60) are counted as on every fresh-brief round.

**Result.**
