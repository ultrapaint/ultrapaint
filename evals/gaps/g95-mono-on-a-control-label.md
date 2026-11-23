---
id: g95
title: Mono on a control's label because its text is an id
kind: missing
status: open
found: 2026-11-23
source: the person, on fx-opus-new23 (decisions/new23)
skill: [references/typography.md]
sections: []
---

**What happened.** On the status page, run 2 set the region tabs (`us-east-1`, `eu-west-1`, …) in
the mono. The person chose run 2 over run 1 but: "I don't like the mono font in the tabs of the
regions".

**The skill now.** `references/typography.md`: "A mono beside it for code, ids, timers and small
uppercase labels". A region's name is an id, so the tabs took the mono, although a tab is a control
read as navigation, not a value read or copied.

**Proposed.** In `references/typography.md`, the mono line: "for code, and for ids and timers read
or copied as values (in running text, a cell, a field); a control's label (a tab, a button, a menu
item) stays in the sans, even when it names an id." A Check row: "A tab, a button or a menu item in
the mono | The sans; the mono for the value it names, where that value is read".

**Test.** `fresh-status-page`, 2 runs, Opus designing with the candidate: no tab, button or menu
item in the mono; ids in the incident text may stay in it.

**Result.**
