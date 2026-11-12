# ADR 0084: The lab studies motion from its source

Status: accepted, 2026-11-12 (the person: "motion should be on the lab's plan"). Adds a track to
ADR 0082; changes how the lab works, not the editor.

## Context

The design skill's motion reference (`skills/ultrapaint/references/motion.md`) gives curves,
duration ranges, stagger limits and gating, written by hand. Nothing in the lab has checked those
values against shipped work, and the corpus can't: it is screenshots, and a picture holds a
motion's end state only. The October notes and the catalogue of moves (`moves/`) mention motion
in passing, as a still observer would (44 lines in `moves.md`).

Libraries that show motion as video or GIFs (Pixlpin, Dribbble) hold concept pieces more than
shipped motion, and their terms leave the rights with each creator and forbid collecting.
Screenrove's motion catalogue (165 entries on 12 Nov: overlays, chat and AI states, navigation,
buttons, loaders, lists, toggles, toasts, numbers) gives each entry its trigger, a measured spec
(durations, curves, springs), why it works, what to keep when rebuilding it, a demo and code. Its
sources are open-source component libraries, with a link to the original code.

## Decision

1. **Motion is a lab track beside the corpus study.** It answers the same two questions as
   ADR 0082, for change over time: what well-made motion shares, by kind of change and by how
   often the user sees it (ranges for durations, curves and springs, what moves and what
   doesn't), and the distinctive motion moves, which join the catalogue of moves with the same
   fields.
2. **Motion is read from its source, not from pictures.** The spec is taken from the original
   code where there is one: durations, curves, spring constants, which properties, what gates
   it. A recording of the rendered demo is the check when the code and the spec disagree.
3. **Sources.** Screenrove's motion entries, read through its API at its rate limit, as the
   index. The lab keeps its own notes, each entry's ID and its source link, not Screenrove's
   pages. The original code comes from its repository, under that library's licence, and the
   licence is noted with each entry. Libraries whose terms forbid collecting are browsed by
   hand at most.
4. **The skill gets what the study supports, through gaps.** Where shipped motion contradicts
   `motion.md` (a range, a curve, a rule), that becomes a gap in `evals/gaps/`, and a candidate
   is measured before it ships. Motion moves reach the skill with the other moves. The skill
   names no library or product the motion came from (ADR 0082, 3).
5. **Measured on fresh briefs.** The page rounds of ADR 0082 also count the motion a design
   writes and builds: each transition written down (trigger · what moves · duration · curve),
   its values within the study's ranges, and what the built page actually runs (its computed
   transitions and animations, read in the browser as ADR 0081's checks are). Resemblance to a
   source is never scored.

## Consequences

- The model and the cost are named before any motion job runs (`lab-model-choice`). Reading 165
  entries and their code is text, cheap next to a picture study.
- The study's data lives in the lab's data directory under `motion/`: the notes, the ranges and
  the motion moves, with their source links and licences.
- A check of built motion (point 5) is lab code at first. Running it in the editor, as one of
  ADR 0081's checks, would be the editor thread's change and needs its own ADR.
