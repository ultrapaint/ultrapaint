---
id: p03
title: The final tables check defects, not weight
kind: process
status: open
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [SKILL.md, references/hierarchy.md]
sections: [components-panel, chat-starters]
---

**What happened.** Each "Before you finish" table lists local defects. None asks whether the
whole section's ranking is right. `hierarchy.md` has the squint test, but the closing check in
`SKILL.md` step 6 doesn't require it for each section.

**Proposed.** End step 6 with a squint for each section: name its three heaviest things. They
must be what the section is for.

**Test.** Count the hierarchy findings caught with and without it.

**Result.**
