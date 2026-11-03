---
id: g04
title: A hint shown when it says nothing
kind: missing
status: open
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [references/restraint.md]
sections: [components-panel]
---

**What happened.** The Components panel always showed "Inserts into …" at its top, even with
nothing selected, when it only named the default target.

**The skill now.** `restraint.md` cuts what repeats its neighbour. It says nothing about context
that depends on state.

**Proposed.** Context that depends on a selection or a mode appears only in that state, beside
the action it affects (here, a footer shown with a selection).

**Test.** Panels whose action depends on a selection, drawn in both states.

**Result.**
