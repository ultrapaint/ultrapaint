# ADR 0101: The lab judges flows, and whether a screen can be used

Status: accepted, 2026-11-17. Extends 0082. Changes how the lab works, not the editor.

## Context

The fresh briefs (0082) are judged from a run's pictures at the app's bare address. A brief that
is a flow, such as the three steps of sign-up and setup in `fresh-bookkeeping-onboarding`, was
built as one page with its steps in state, so the judges saw step 1 alone: progress, going back,
errors and the done state were never in front of them. The pairwise judge gives a side at eight
levels of the look (layout to craft); none of them asks whether the person can do what the screen
is for. The design skill teaches that (`usability.md`, `states.md`, the kinds' files), and the lab
could not show whether it works.

## Decision

1. **A fresh brief can be a short flow.** Its `reference.json` lists its `screens` in order, each a
   name and the state it is drawn in. The agent is told to show each at `?screen=<name>`, the
   first at the bare address too, with the flow between them still working. A brief of one screen
   is told what it was told before, word for word.
2. **Every screen is photographed.** The first under the names a run's pictures always had
   (`desktop-fold.jpg`, `desktop-01.jpg`), a later one under its place and name
   (`desktop@2-business-fold.jpg`), so `variety`, `review` and the extract keep reading the first
   screen, and the pairwise judge sees the whole flow and judges it as one.
3. **Use is a level of the pairwise judge**, the ninth: whether the person can do what the screen
   is for, the main action found at once, a way back or out at every step, each state the brief
   names drawn, and words that say what happens next. Verdicts kept from before it have no use
   level, and a run judged once is not asked again: use is counted on pairs judged since.
4. **Four flow briefs join the fresh set**, across characters: a checkout, inviting people to a
   workspace, booking an appointment on a phone, and cancelling a subscription.

## Consequences

- A flow's run takes a picture per screen and viewport, so its judging reads more pictures.
- A design that draws only its first screen, or a state the brief names as a copy of another,
  loses at use, where before nothing saw it.
- The tells count every picture a run has: a flow's counts are per flow, compared only with runs of
  the same brief.
