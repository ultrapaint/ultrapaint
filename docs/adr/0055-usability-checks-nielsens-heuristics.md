# ADR 0055: Usability checks Nielsen's heuristics

Status: accepted, 2026-11-03.

## Context

The design skill's parts say how a screen looks and reads: its hierarchy, type, colour, states,
words. Jakob Nielsen's ten heuristics are how an expert reviews whether an interface can be used,
and five of them had a home already (system status in states, the user's words and error messages
in content, minimalism in restraint and hierarchy). The other five had no rule anywhere: a way out
of every dialog, step and mode; one name and place per action; constraints before errors; what a
decision needs kept in view; shortcuts for a daily tool; help where the question comes.

## Decision

- A part of its own, `usability.md`, reached from the router's table when a screen has actions and
  flows, named by the heuristics. It holds the five rules no part had, and points to the part that
  owns each of the others, so a rule still lives in one place.
- It ends on a "Before you finish" table like every part.

## Consequences

- The design evals do not measure it: their rounds score static remakes of screens, not flows. A
  review of a flow is where it shows.
