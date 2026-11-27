# ADR 0081: The checks' findings go to the designer, not to the reviewers

Status: accepted, 2026-11-23, built with UP-75 (see "As built"). Amended by
[0156](0156-a-checks-decline-holds-until-its-node-changes.md): a decline holds in the thread
until its node changes, the checks read what the turns changed, and the values off the system are
one finding a kind. Amended by [0157](0157-the-person-decides-a-decline-the-page-shows.md): a
review model's finding the designer would decline is put to the person first; a check's is still
declined alone, never asked. Proposed 2026-11-11 by the design lab. Amends [0061](0061-designs-are-checked-before-they-are-reviewed.md), whose third layer
gave the review models the checks' results as facts. In the lab, `recall` counts both ways
already (`--inputs checks`).

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
   (`Declined: <title> — <reason>`, by its number since UP-218: see "As built"). The findings
   log keeps the declines by kind, and they are the sample a kind's precision is read from
   again, with the person rating the declines blind.
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

## As built

- **The editor measures the review's picture.** Asked for a page's picture with `checks`
  (contracts' `ScreenshotRequest`), it draws the page in its hidden frame and, once the frame has
  settled, runs `design-checks` on the frame's shadow root: `spacingFindings` (3× between stacked
  groups of rows, 2× between other groups) and the `touching-rows` audit. Their findings come back
  with the picture (`RenderedFinding`); an answer without them is valid, and the round goes on
  with the reviewers' findings and the document's.
- **What the designer is sent.** The checks' findings follow the reviewers' in the findings
  prompt, numbered on, each marked as a check's with what it measured and the element it names;
  the document's values off the system are one finding a value ("13px spacing, 9 places").
  They go beside the reviewers' findings, or alone once the review is over (approved, or at a
  cap), when the review still ends there; a review no model could score sends nothing.
- **Declines.** A check's finding declined (`Declined: <number> — <reason>`) is kept on the
  round and in the findings log with its kind (`check`), and is not sent again in the same run.
  A second look is never shown the checks' findings.
- **Readable titles** (UP-218). A check's finding is titled in about 60 characters by its kind,
  its value as it reads and its first element ("Hand-set colour rgba(12, 10, 40, 0.6) in a
  gradient on Hero", "Hand-set spacing 6px on Row 1 and others"), the others uncounted so that a
  declined title stays the same while its places change; the whole value is its `problem`. A
  fill of several fill layers reports the raw stop or colour layer, not the whole fill (ADR 0134,
  0149). A block is labelled by its first line, cut at a word with an ellipsis, and a page is
  named as the canvas names it, so the home page is "Home". The designer declines a finding by
  its number (`Declined: 12 — <reason>`); a title shortened with an ellipsis, at its end or
  inside it, is read too when it fits one finding alone.
- **Groups set too close left the list** (UP-219). The designers declined most `groups-apart`
  findings in two client projects (75 of 139 declines in one day), and the person upheld the
  declines: near 10 to 20% real, under §3's 80%. The designer is sent `touching-rows` and
  `off-system` only (`SENT_CHECKS`, `check-findings.ts`); the editor still measures the kind, so
  putting it back is a server change once a rating deck of the fixed check passes at 80%, the
  logged declines planted as known negatives (§4).
- **The groups' check reads edges** (UP-219). Its misfires were bordered option cards measured as
  one list by their text, a header band against the content under it, and a notice against the
  fields it is about. `layoutInBrowser` now marks a block **boxed** (a border of 1px or more on
  every side, a shadow that draws, or a fill apart from what it sits on inside the measured root)
  and one that starts a **region** (it scrolls on its own, is fixed or sticky, or is a filled or
  bordered band across the page at its parent's top or bottom), and keeps such a block whole when
  it wraps one child. A divider under a row is not a box. `spacingFindings` measures a box under a
  block as one of its lines, edge to edge, and never measures a pair where either block stands
  apart by edges: a box, a region, or a block made only of boxes. The ratio stays the whitespace
  rule for groups with no edge, and still flags the Components panel (g02). The lab's `measure`
  and `recall --inputs checks` run the same functions. The kind stays off the designer's list
  until its rating deck.
