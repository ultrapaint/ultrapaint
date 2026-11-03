---
id: g06
title: An inset panel drawing a double edge
kind: missed
status: open
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [references/spacing.md]
sections: [left-card-raised]
---

**What happened.** The first raised panel was inset 1px, with its own full border, inside the
card. That made two hairlines with a 1px gutter between them.

**The skill now.** `spacing.md`: "One edge is drawn once: never a line and a surface for the
same group."

**Why it was missed.** The screens were only looked at whole, at full size, where a 1px gutter
can't be seen.

**Proposed.** See P4.

**Test.** The same screens reviewed whole versus as 2× crops. Count the double edges found.

**Result.**
