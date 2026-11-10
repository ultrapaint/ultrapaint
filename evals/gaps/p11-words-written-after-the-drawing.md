---
id: p11
title: Words written after the drawing
kind: process
status: testing
found: 2026-11-06
source: catchable-2 (runs/catchable-2/report.md), with p06 and ADR 0061's outline
skill: [SKILL.md, references/words/interface.md]
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
- `copy-base` against `copy-words`: 2026-11-06, the designer's side. The step in the router's
  design steps (branch `experiment/copy-words-first`, 1a3cab0) against the shipped router
  (ffedc8f), three Untitled UI settings screens from their briefs without pictures, 2 runs each,
  Opus 5.5 designing; an Opus panel (effort high, the shipped skill) on every section. Problems
  per run: shipped 28.0 (5 runs; notification-settings run 1 ran out of time and drew nothing),
  candidate 35.3 (6 runs); word problems 0.2 in both. The judge's fidelity went the other way:
  shipped 2.8, candidate 3.2. No trace shows a list of the words, and `content.md` was read once
  in six runs: the agents didn't follow the step. Those runs also took half the time
  (179 s against about 350 s). (runs/copy-base/panel.md, runs/copy-words/panel.md, and
  `compare copy-base copy-words`)
- Decision of 2026-11-06 (made by the agent, as the person asked): not shipped. A brief fixes the
  words ("use its content as written"), so these rounds leave the designer almost none to write,
  and the panel found as few word problems either way. The test the gap needs is a design whose
  words are the designer's: a redesign of a screen with its own copy (p06's case) or a request
  with no brief, which the lab has not got yet; g52 needs the same.
- `rb-recall-before`: 2026-11-08, its sections' gaps caught: shipped 69/92 (+13 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-before/report.md)
- `rb-recall-after`: 2026-11-08, its sections' gaps caught: shipped 57/92 (+21 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-after/report.md)
- `rb-recall-check`: 2026-11-08, its sections' gaps caught: rb-check 57/92 (+24 partly) (cursor:grok-4.7-high, effort high; runs/rb-recall-check/report.md)
