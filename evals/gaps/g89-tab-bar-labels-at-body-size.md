---
id: g89
title: A phone tab bar's labels at body size
kind: missing
status: done
found: 2026-11-21
source: the person, on fx-opus-new20 (decisions/new20)
skill: [references/kinds/navigation.md]
sections: []
---

**What happened.** On the phone bank home, run 2 set the bottom bar's labels (Home, Payments,
Cards, Savings, More) at about `17px`, the size of the screen's body text, where a tab bar's labels
are `10–12px` under their icons. The person chose run 1, agreeing with the call that named it.

**The skill now.** `references/layout.md` names "a bottom bar" for phone navigation;
`references/kinds/navigation.md` says nothing of its labels.

**Proposed.** In `navigation.md`: "A phone's bottom bar: four or five icons, each over a `10–12px`
label in the control's weight; the current one in the foreground or the accent, the others
muted."

**Test.** The phone briefs (`fresh-bank-home`, `fresh-flow-booking`), 2 runs each, Opus designing
with the candidate: the bottom bar's label size. It passes at `10–12px` in every run that draws one, with at least two runs
drawing one; with fewer, the test is inconclusive and runs again.

**Result.**
- `fx-opus-c20`: 2026-11-21, `candidates/new20` (the bottom bar in `navigation.md`, routed from
  `SKILL.md`), `fresh-bank-home`, 2 runs, Opus in Claude Code designing: both runs drew a bottom
  bar, labels about `12px` (against about `17px` in `fx-opus-new20` run 2). It passes.
- Decision of 2026-11-22 (`decisions/new20-ship`): shipped.
