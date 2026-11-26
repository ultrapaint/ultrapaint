---
id: g101
title: A take of a navigation that cannot show its hover and focus
kind: missing
status: open
found: 2026-11-25
source: the person's variations of a client app's sidebar and row, usage logs of 2026-11-10 → 25
skill: [references/states.md, references/kinds/navigation.md]
sections: []
---

**What happened.** The person ran Variations twice on a client app's sidebar and a list row to
compare hover and focus treatments. Each take drew the rows at rest, and the agent said a variation
can't show how the other rows look under the pointer. The person had nothing to compare.

**The skill now.** `references/states.md`, "Draw each beside the loaded one": "Each state is its own
copy of the screen or of the region that changes, beside the loaded one", and its list of a
component's states (default, hover, pressed, focused, selected, disabled) is drawn through the
component's own props. Nothing says that a take whose subject is an interaction state draws that
state.

**Proposed.** Candidate for `references/states.md`: "When the brief is about how a control or a row
looks under the pointer or with focus, each take draws that state: the hovered and the focused item
as labelled copies of the region beside it at rest, not only the region at rest."

**Test.** Variation briefs on a navigation and a list row that ask for hover and focus treatments,
2 runs each at Opus: the share of takes that show a hovered and a focused item, shipped against the
candidate.

**Result.**
