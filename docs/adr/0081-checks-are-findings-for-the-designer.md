# ADR 0081: The checks' findings go to the designer, not to the reviewers

Status: proposed, 2026-11-11, by the design lab. Amends [0061](0061-designs-are-checked-before-they-are-reviewed.md),
whose third layer gives the review models the checks' results as facts. The editor's side is for
the editor's thread to build. In the lab, `recall` counts both ways already (`--inputs checks`).

## Context

ADR 0061 runs general checks before the review and hands what they measured to the reviewers
as facts. Since 11 November the editor does that with the document's off-system values
(`page-views.ts`, `documentChecks`). The lab measured that hand-off on the four sections of the
gaps no reviewer had caught (components panel, tools bar, Layers, Changes): 31 gaps, Opus
reviewing, 3 runs (`runs/chk-1`, `reports/skill-plan-2026-11-11.md` §6):

| | Caught, of 93 |
| --- | --- |
| The review alone, pictures and code | 69 |
| The review shown the measurements | 66 |
| The review alone, the checks' findings added beside it | 83 |

- Shown the measurements, the reviewers caught every measurable gap (g02, g08, g34, g37: 12 of 12,
  against 1 of 12), but lost the judgement ones (19 of 21 → 4 of 21). A review writes about 17
  findings whatever it is shown, so each measured finding took the place of a judgement one.
- Added beside the review, the checks catch six of these gaps in every run (g02, g08, g34, g37,
  g43, g49), and the review keeps its own catches.
- The person rated each kind of check on the editor's own panels (`decisions/checks-precision`,
  43 cards, the agent's call hidden): 42 real, 0 noise. Every kind was rated real wherever it was
  sampled: off-scale values 6/6, control fill 5/5, control edge 5/5, surface tone 5/5,
  hover-only 5/5, groups 4/4, can't truncate 3/3, touching rows 2/2, dividers, clipped text and
  overlay tone 1/1. One answer changed a check: a target under 24px is no problem when a
  clickable label makes it larger, so the target check now counts a control's labels (8c66be7b).
- Those rates are sampled thin (1–6 a kind) and had no planted false alarms, so they say the
  checks' findings were real, not that a check never misfires.

Impeccable orders its own tools the same way: its detector runs after the model's review, because
detector results shown first "anchor judgment".

## Decision

1. **The reviewers are not shown the checks.** A review model gets the request, the pictures,
   the code and the skill's rules (ADR 0077), and nothing the checks measured.
2. **The checks' findings go to the designer as findings of their own**, in the same findings
   prompt as the reviewers', each one marked as a check's, with its measured value and the element
   it names ("groups: 27px between “App components” and “System components”, 10px between the
   lines below"). The checks have no score or approval of their own.
3. **The kinds that go** are those the person rated real at 80% or more:
   the document's off-system values and, once the editor checks the rendered page, the kinds
   above. A kind joins after its own rating deck; one that falls under 80% leaves.
4. **The designer may decline a check's finding**, with a reason, as it may a reviewer's
   (`Declined: <title> — <reason>`). The findings log keeps the declines by kind, and they are
   the sample a kind's precision is read from again, with the person rating the declines blind.
5. **Approval is unchanged.** A check's finding counts as minor and never holds back approval by
   itself; whether a measured finding should block (a target under 24px, text contrast) is left
   for the loop's next round of measurement (R4, R5 in the plan).

## Consequences

- The review prompt is shorter: the document's check lines leave it.
- Whatever the checks miss, the review is unchanged by them. Counted on chk-1, 83 of 93 instead
  of 66.
- The designer gets more findings per round: 3–15 a section from the precise kinds, many more
  from off-scale values (4–43 a section, mostly the editor's own half-step paddings). Grouping
  off-scale values by value ("6px, 9 places") keeps the prompt readable. That waits on the
  editor's thread.
- No negative control yet: the next precision deck plants findings on fixed states, so a kind's
  rate includes its false alarms.
- The lab measures the same arrangement in a loop round (`recall --inputs checks` counts it
  without a model); the editor's review loop is not changed by this ADR until it is accepted.
