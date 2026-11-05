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

A design goes through four layers, the cheap ones first:

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
3. **One judgement review.** One fresh, read-only reviewer per round looks at the page, given the
   pictures, the code, the request and the checks' results as facts; it reviews what takes
   judgement (hierarchy, restraint, character, what an icon suggests) and scores as ADR 0060
   says. Usually one round; another when it leaves a blocker or a major.
4. **The council on demand.** The person's council (ADR 0060) reviews for sign-off: on a screen
   that matters, or when the person asks.

Every recurring finding of the findings log is turned, in this order of preference, into a check
(when code can decide it), an outline item (when the outline shows it), or a rule of the skill
(issue #8); rules the models follow without being told go (issue #9).

## Consequences

- The designer's turns stay near a design without review; the review is one more turn, not one
  per section.
- The checks are code to keep: each with its threshold, its tests and its record on the gaps.
- Surfaces nearly one tone are flagged under 0.008 oklch lightness apart, from the fix of g05 the
  person accepted (0.011); `elevation.md` asks for about 0.045. The two disagree, and the skill's
  number is to be measured again.
- A reviewer's result varies between rounds (GPT-6.1-Sol caught 45 of 100 in one round and 73 in
  another on the same sections and skill): only results within one round are compared.
