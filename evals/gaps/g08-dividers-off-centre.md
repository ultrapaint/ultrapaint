---
id: g08
title: Dividers off-centre in a bar
kind: process
status: testing
found: 2026-11-03
source: editor redesign (branch redesign)
skill: []
sections: [tools-bar]
---

**What happened.** The toolbar's vertical dividers hung from the top of the bar. The
Separator's `data-vertical:self-stretch` overrode `h-5 self-center`. The person caught it, not
the review.

**The skill now.** This is a code bug, so no rule applies. The review should have seen it.

**Proposed.** Check the alignment of every toolbar from a 2× crop, or measure it: a divider's
vertical centre is its bar's.

**Test.** As in G6.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 0/2, redesign-gaps 0/2 (+1 partly) (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): no wording caught it, even from a 2× crop of the bar: it needs a measured check of each divider's centre against its bar's.
