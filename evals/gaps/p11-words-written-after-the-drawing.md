---
id: p11
title: Words written after the drawing
kind: process
status: testing
found: 2026-11-06
source: catchable-2 (runs/catchable-2/report.md), with p06 and ADR 0061's outline
skill: [references/content.md]
sections: [changes, settings, chat-starters, layers, components-panel]
---

**Setup.** `pnpm evals catchable` (catchable-2, gpt-6.1-sol, medium) sorted every finding held by
the cheapest way it could have been caught. Of the gaps and the held-out findings rated real that
are about words (labels in mixed forms g13, g32 and settings-14; one fact in two formats g33 and
changes-12; one action under two names changes-7; a title that repeats the nav g31 and
settings-16; wordy empty states changes-33; a hint that says nothing g04; a count shown twice g30
and changes-24), every one sorted as `outline`: a text list of the words, written before drawing,
shows it. None sorted as `code`: no finding about words is one a program would catch.

**What happened.** The words are written while drawing, node by node, and checked, if at all, in
the closing tables against the pictures. p06 (copy kept because it was there) is the same pattern
on inherited copy.

**Proposed.** In `content.md`'s steps: before drawing, write every text the design shows (each
heading, label, action, message, empty and error text, in each state the screen is in) as a list,
inherited words as much as new ones, and run the content tables on that list. A reviewer told the
skill reads the words the same way.

**Test.** Recall on the five sections that hold the word gaps, the shipped skill against the
candidate `copy-outline`, 2 runs: the word gaps caught, and no fewer of the others. The designer's
side is a round with the candidate against the shipped skill, its panel counting the word
problems.

**Result.**

- `recall-copy-1`: 2026-11-06, its sections' gaps caught: shipped 77/92 (+7 partly), content-single 76/92 (+5 partly), copy-outline 72/92 (+4 partly) (opus, effort high; runs/recall-copy-1/report.md)
- Decision of 2026-11-06 (made by the agent, as the person asked): not shipped. On the twelve gaps
  about words (g04, g12, g13, g16, g27, g29–g33, g46, g52) `copy-outline` caught 23/24 against
  shipped 19/24 (+3 partly), but on the other 34 it caught 49/68 against 58/68, losing most where
  the look is the problem (g37, g38, g39, g43, g44, g48). The list took the reviewer's attention
  off the look. Next to try: the list in the designer's steps only, measured by a round and its
  panel, not by recall.
