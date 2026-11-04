---
id: g01
title: An empty section drawn as an empty page
kind: missing
status: wontfix
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [references/states.md]
sections: [components-panel]
---

**What happened.** In the Components panel, "In this project" had no components yet. It showed
the full empty state (icon, title, sentence, button) between full groups, so the heaviest block
in the panel was the one with nothing in it.

**The skill now.** `states.md` ("Empty states start something") says the region keeps its place
and offers one action. It doesn't say how big that should be.

**Proposed** (for `states.md`). An empty section inside a populated list is one row, shaped like
the list's rows, with its action. The full empty state (icon, title, sentence, action) is for an
empty panel or page.

**Test.** A list with one empty group among full ones. Pass when the empty group is about one
row tall and isn't among the three heaviest things on a squint.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 2/2, redesign-gaps 2/2 (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): the shipped skill caught it 2/2 with an independent reviewer per section: missed through how the redesign was run (P2, P4), not for want of a rule.
- Decision of 2026-11-03 (`decisions/recall-redesign-1`): no rule: the shipped skill caught it 2/2 with an independent reviewer per section, so what missed it was how the redesign was run (p02, p04). The candidate's rule was dropped.
- `recall-closing-check-1`: 2026-11-04, caught: shipped 2/2, closing-check 2/2 (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- `held-out-1`: 2026-11-04, caught: shipped 2/2, held-out-themes 2/2, held-out-plain 1/2 (+1 partly) (opus, effort high; runs/held-out-1/report.md)
