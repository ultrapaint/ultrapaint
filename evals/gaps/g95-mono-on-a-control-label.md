---
id: g95
title: Mono on a control's label because its text is an id
kind: missing
status: done
found: 2026-11-23
source: the person, on fx-opus-new23 (decisions/new23)
skill: [references/typography.md, references/character.md, references/system/foundations.md]
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
- `fx-opus-new23c`: 2026-11-23, `candidates/new23` (the mono for code, and ids and timers read or
  copied as values; a control's label in the sans), `fresh-status-page`, 2 runs, Opus in Claude
  Code designing: no mono anywhere in 2 of 2, the region tabs in the sans.
- Decision of 2026-11-23 (`decisions/new23c`): right, but wider: "the using of the mono font is
  something that should be really weighted in every ui element, not only in this tab case. The mono
  font is something AI likes to use but 99% should not be used". Not shipped as written; a wider
  candidate (`candidates/g95-wide`: the mono for code only, ids, times, figures, labels, tabs,
  buttons, captions and cells in the sans, its tabular figures in a column) is tested on
  `fresh-status-page`, `fresh-audit-log` and `fresh-docs-webhooks`.
- `fx-opus-g95wide`: 2026-11-23, `candidates/g95-wide` (the skill on main with g75's border rule, and
  the mono for code only: a code block, a command, a key or a token copied; ids, times, figures,
  labels, tabs, buttons, captions and cells in the sans, its tabular figures in a column),
  `fresh-status-page` and `fresh-audit-log`, 2 runs each, Opus in Claude Code designing. The mono
  outside code: none in 4 runs, apart from one event id in run 1's detail panel; on main, 3 of 4
  runs of these briefs (`fx-opus-new23`, `fx-opus-new23b`) set times, IP addresses, before and after
  values or tabs in it. `fresh-docs-webhooks`, where code needs the mono, did not run: the week
  reached its limit.
- Decision of 2026-11-23 (`decisions/g95-wide`): ship, as the agent called it. Shipped in
  `references/typography.md` (the type voice, the small labels, the Check row),
  `references/character.md` and `references/system/foundations.md`.
- 2026-11-23, on PR #118: the person kept the public pages' chosen moves that set mono (a
  monospace label layer, portfolio captions, landing indices); the rule and its Check row name
  that exception.
