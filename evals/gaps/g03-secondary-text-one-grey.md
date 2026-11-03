---
id: g03
title: Every secondary text the same grey
kind: missing
status: testing
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [references/color.md, references/typography.md, references/components.md]
sections: [components-panel]
---

**What happened.** In the Components panel, all of these were `font-small` in the muted
colour:
- group labels;
- counts;
- the "Inserts into …" line;
- descriptions.

The panel read as names floating in one grey mass. The labels that structure it looked no
different from the details that qualify a row.

**The skill now.**
- `color.md` and `typography.md`: two text colours, foreground and muted.
- `components.md`: a count is "quiet".
- Nothing limits how many roles muted text plays in one region, and nothing says a group label
  must outrank its rows' details.

**Proposed.** A group label outranks the details inside its group, by weight or position (for
example `font-heading-xsmall`, or a caption-sized label set apart by space), never the same
small grey as a count. In one region, muted text plays at most two roles.

**Test.** Lists with labels, counts and descriptions. A judge names the groups from a blurred
screenshot.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 0/2, redesign-gaps 2/2 (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): the candidate's rule took it from 0/2 to 2/2 (partly by construction); a held-out instance (Layers' canvas group label) is for the person to rate.
