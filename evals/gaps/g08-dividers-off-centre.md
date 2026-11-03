---
id: g08
title: Dividers off-centre in a bar
kind: process
status: open
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
