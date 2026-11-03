---
id: g09
title: Chrome attached to a canvas object breaks at zoom
kind: missing
status: open
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [references/patterns.md]
sections: [element-toolbar]
---

**What happened.** The selected element's toolbar (its name and its actions), attached to the
selection:
- covered small elements when zoomed out;
- drifted off-screen when zoomed in.

**The fix used** (branch `redesign`, `a647e13`):
- A name tag with one action stays attached, capped to the element's width, and shrinks below
  a threshold.
- The element's other controls dock in a fixed bar above the tools, as do a page's and those of
  several elements.

**The skill now.** No pattern under `patterns/` covers a canvas or chrome that follows an
object.

**Proposed.** A canvas-tools pattern for:
- what stays attached to an object;
- what docks;
- how attached chrome behaves at both zoom extremes.

**Test.** Editor-like pieces with a selection, drawn at three zoom levels.

**Result.**
