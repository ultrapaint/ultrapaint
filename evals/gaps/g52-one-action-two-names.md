---
id: g52
title: One action under two names
kind: missed
status: testing
found: 2026-11-04
source: the Changes panel, editor redesign at f608871 (held-out finding changes-7, rated real)
skill: [references/words/voice.md, SKILL.md]
sections: [changes]
---

**What happened.** Going back to a point is "Restore" on snapshots and "Revert to it" on
checkpoints, and making a snapshot is "Save snapshot" (Plus) in one place and "Keep as snapshot"
(BookmarkPlus) in another.

**How it was found.** A fresh reviewer per section, in `recall-redesign-1`, on a section no gap
named: shipped 2/2, candidate 2/2. The person rated it real (`decisions/held-out-rest`,
changes-7). Theme: names.

**The skill now.** `content/voice.md`: "If it is a workspace in the menu, it is a workspace in
the toast. A flow keeps one vocabulary", and its table: "Two names for one thing → the one the
product already uses". Reviewers catch it; the designer wrote the panel with no list of the
product's names to write from. Since ADR 0067 the design-system job writes what the product chose
for its words in DESIGN.md's Content section, from the copy it already has, but nothing says the
names are listed there, and this repository's Content lists none.

**Proposed.** DESIGN.md's Content holds the product's vocabulary, a table of each thing and action
with its one name and the words not used for it; `voice.md` says to read it before writing and to
add a name a screen introduces.

**Test.** Recall on `changes`: reviewers caught it 2/2 in `recall-redesign-1` but only partly
with the shipped skill in `recall-copy-1`, so recall measures it. Where it went wrong is design
time: a round on a host whose DESIGN.md Content lists the vocabulary against the same host
without it, the agent designing two screens of one flow from one brief, counting the names each
thing and action gets. That round needs a brief of two screens, which the lab has not got yet.

**Result.**

- `recall-copy-1`: 2026-11-06, caught: shipped 0/2 (+2 partly), content-single 1/2 (+1 partly), copy-outline 2/2 (opus, effort high; runs/recall-copy-1/report.md)
- Decision of 2026-11-06 (made by the agent, as the person asked): not shipped. The candidate that
  caught it, `copy-outline`, is p11's, and it is not shipped (see p11). The vocabulary in
  DESIGN.md's Content waits for the design-time round.
- `rb-recall-before`: 2026-11-08, caught: shipped 0/2 (+2 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, caught: shipped 0/2 (+1 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, caught: rb-check 0/2 (+2 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
