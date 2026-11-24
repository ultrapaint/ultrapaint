# ADR 0129: A turn's questions fold into its card, and an agent whose questions lapse doesn't write them out

Status: accepted, 2026-11-24. Amends 0095 (what stays in the transcript as it is) and 0022 (what
the agent hears when its questions go unanswered).

## Context

0095 left answered questions in the transcript as they were: under the turn's card, a box per
card, "Answered" over each question in full and the answer under it. A card of four questions was
four paragraphs of the agent's words for four short answers. The person found them too verbose
and asked for them in the turn's card, folded.

A card no agent waits on any more (No longer asked or Declined, 0109 and 0125) was drawn the same
way, every question in full with a dash for the answer it never got: the wall of text the person
saw when questions lapsed. And when the questions were dismissed, `ask_user` told the agent only
"Do not ask again unless the user does", which left it free to write them out in its reply.

Three directions were mocked in the running editor (a row in the card; inside the steps; each
answer as the person's reply with lapsed cards as one line) and the person chose the row.

## Decision

**A turn's questions that no longer wait are one row of its card** (`TurnParts.asked`, the web's
`Asked`), under the review's line and over the steps, while the agent works and once it is done:

- with answers: "You answered" muted, then the answers in the foreground, in the order asked,
  joined by " · " and cut to the row; "N not answered" at its end when some were not;
- with none: how the cards ended, each once ("No longer asked", "Declined", "Skipped" for a
  card sent with every question skipped), and "N questions";
- opened: each question, muted, and under it its answer, when there is one; never a dash;
- answers that may not have reached the agent (`undelivered`) read "Delivery not confirmed"
  in place of "You answered", and keep "The agent may not have these answers. Say them again in
  the chat." in view under the row.

The open question still sits over the composer. Permissions and notices stay in the transcript
as they are. "Show every step" draws a card no longer waiting as the same row, bordered.

**When the questions go unanswered** (the form dismissed, withdrawn or let go), `ask_user` tells
the agent to carry on with its own choices and say each in a line, not to write the questions
out, and not to ask again unless the person does. A decline is unchanged.

## Consequences

The person reads their own answers at a glance and the agent's questions only when they open the
row. A lapsed card costs one line. An agent that ignores the instruction can still repeat its
questions in a reply; the chat no longer does.
