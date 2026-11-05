# ADR 0061: A design is checked before it is reviewed

Status: proposed, 2026-11-05. Amends ADR 0060, whose council stays. A design round compares this
with the council every round (step 4 of `docs/plans/PLAN-review-loop.md`) before the editor is
built for it.

## Context

ADR 0060 has a council of vision reviewers review each section, every round, reading the whole
skill each time: the costliest way to catch a problem. On one screen it took the designer from
3.4–4.3M tokens to 9.1M (one review at the end) or 16.6M (per section), and $15 of reviewers.
Most of what the person found isn't something only eyes can catch. Measured on 2026-11-05
(`~/Code/ultrapaint-data/runs/shift-left-1/summary.md`):

- **Sorted by the cheapest way to catch them** (`pnpm evals catchable`): of the person's 50 gaps,
  40% a general check could catch, 40% a text outline would show, 20% need eyes; of the 67
  held-out findings the person rated real, 49%, 39% and 12%.
- **An outline instead of pictures** (`recall --inputs outline`, GPT-6.1-Sol, one round): on the
  gaps an outline can show, 27 of 40 caught against 33 with pictures and code; 2 of 40 on those
  only code checks see; 40 of 100 overall against 73.
- **General checks on the rendered editor** (`measure --checks --hover --stress`, run on the
  states before and after the fixes): rows touching (g37), a name that can't truncate (g43), a
  checkbox's target (g49) and the fold chevrons' were caught before their fix and gone after; a
  dialog below the page (g44) was caught in both, as it stays. Missed: nested surfaces of one tone
  (g05), a picker's fill on a tint (g07). A computed spacing check was noise, the editor's half
  steps looking like values off the scale; a filled-control check was noise in light.
- **On the document** (`pnpm evals off-system`): every design agents made in three rounds left
  values off its design system, 8 to 274 per design (spacing off the base's steps, raw radii,
  colours and type sizes).
- Reviewers given the code as well as the pictures caught 25 of the 40 checks on code-kind gaps
  by reading it.

## Decision

A design goes through three layers, the cheap ones first:

1. **An outline first.** Before the first node, the designer writes the outline: its sections,
   their words, their actions and the states each shows. A short checklist from the skill is run
   on it: what can't act, what's missing in a state, a fact shown twice, labels in mixed forms.
2. **Checks at each edit.** General checks, written once for every screen, run on what the
   designer changed and come back in the same tool result, with no review turn:
   - on the document: values off the design system (design-document's `offSystemValues`);
   - on the rendered page, only those shown precise: targets under 24px, text contrast, a dialog
     below the page it covers, rows that touch, names that can't truncate. Surfaces nearly one
     tone, filled controls that don't separate and controls shown only on hover are measured but
     not yet trusted.

   A check joins this list when it catches its gaps on their "before" states with no alarm on the
   fixed ones (`measure --checks`).
3. **The review.** The council of ADR 0060 reviews in rounds. A reviewer is the same whichever
   round it reviews: fresh, read-only, given the request, the pictures, the code and the checks'
   results as facts, it reviews what takes judgement (hierarchy, restraint, character, what an
   icon suggests), and answers with findings, its score and its sign-off. Two settings say how
   much of the council looks:
   - **Each round** (`eachRound`): `one`, the council's first member; `rotate`, the members in
     turn; `all`, the whole council.
   - **Sign-off** (`signOff`): `all`, once a round's reviewers are satisfied the whole council
     reviews the page as it stands, and the loop ends only when every member reaches the goal or
     signs off (or a cap is reached), its findings going back to the designer otherwise; `one`,
     the round's own reviewers close the loop.

   The defaults are `rotate` and `all` (contracts' `DEFAULT_REVIEW`): every round costs one
   reviewer, every member sees the design, and the whole council signs it off. With one member,
   every setting is the same.

The person sets these with the rest of the review (the council, the goal, when in the loop,
whether reviews run, the findings log; contracts' `ReviewSettings`): as their default in the
editor's settings, for a project in its configuration, when a design starts, or in the request in
their own words ("review with Opus and Grok, all of them every round, until 90"). The narrower
wins: the request's, then the design's start, then the project's, then theirs, then the
defaults (`reviewSettingsOf`).

Every recurring finding of the findings log is turned, in this order of preference, into a check
(when code can decide it), an outline item (when the outline shows it), or a rule of the skill
(issue #8); rules the models follow without being told go (issue #9).

## Consequences

- With `rotate`, a round costs one reviewer and one designer turn, not one per council member;
  the whole council looks once at the end. `all` every round costs about three times as much per
  round, and is what step 4 compares `rotate` with.
- The checks are code to keep: each with its threshold, its tests and its record on the gaps.
- Nested surfaces are flagged under 0.045 oklch lightness apart, `elevation.md`'s step. The
  editor's own left card, fixed for g05 at 0.011 apart, falls short of it and is to be fixed.
- A reviewer's result varies between rounds (GPT-6.1-Sol caught 45 of 100 in one round and 73 in
  another on the same sections and skill): only results within one round are compared.
