---
id: g08
title: Dividers off-centre in a bar
kind: process
status: done
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
- Decision of 2026-11-03 (`decisions/recall-redesign-1`): build the measured check (each divider's vertical centre against its bar's), since no wording caught it.
- `measure-1`: 2026-11-04, `pnpm evals measure` flags the three dividers 6px off the tools' line before the fix (2cf4e8e) and none after it; no false alarm on five other pages (runs/measure-1/summary.md).
- `recall-closing-check-1`: 2026-11-04, caught: shipped 0/2, closing-check 0/2 (claude-opus-5-5, effort high; runs/recall-closing-check-1/report.md)
- Closed 2026-11-04 by the measured check, `pnpm evals measure`, which catches it where no wording did (0/2 in every recall round). The editor's `DESIGN.md` asks for dividers centred on their bar's line, checked with it.
- `held-out-1`: 2026-11-04, caught: shipped 0/2, held-out-themes 0/2, held-out-plain 0/2 (opus, effort high; runs/held-out-1/report.md)
