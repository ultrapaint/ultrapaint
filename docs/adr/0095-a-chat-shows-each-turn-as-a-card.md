# ADR 0095: A chat shows each turn as a card, and chooses its own design skills

Status: accepted, 2026-11-13. Amends 0063 (the run card, the Review chip) and 0094 (what a chat
is told).

## Context

A design chat drew what its agent reported as it came: each run of tool calls folded into a line
("Inspected ×2, Tool"), the agent's words between them, the run card where the agent's plan was,
each review round, a line for the turn's end. Its header held the agent's name, Follow and a bar
for the scope with Show. The composer's bar held Attach, the Review chip, the model and Send, which
squeezed to "S…" and "O…" beside an agent's question. And a chat was always told the project's
design skills, so a question or a piece of code could not be asked without them.

The person asked for a concise chat made of the editor's own components rather than the agent's
output, every step still one click away, and for the review and the skills to be chosen in a small
tray under the composer, the Ultrapaint skill by default (the Chat canvas, `docs/designs/chat/`).

## Decision

**A chat shows a turn as its prompt, one card and the agent's last message.**

- A turn is a prompt of the person's and all that came of it up to their next (a round's findings
  sent to the designer stay in its turn).
- The card holds, each section under a hairline, only what the turn has:
  - the page it works on: its picture and name, with "Being edited" and Follow while the agent
    works, or "N files changed" (to Changes) and Show once it is done;
  - the run's Outline, Build and Review while it goes, or where it stopped;
  - the review's line, which opens to its rounds;
  - the steps: while the agent works, what it is doing and for how long; once done, "Worked 5m ·
    9 steps", opening to one line per tool call in words ("Edited a page", the editor's tools named
    by what they do) and the agent's words between them, muted.
- Answered questions, permissions and notices stay in the transcript as they are. An open question
  sits over the composer, as before.
- "Show every step" in the chat's ⋯ menu draws the transcript as the agent reported it, for every
  chat. It is a preference of the person's (`everyStep`), kept in the browser.
- The briefing already asks the agent to say its plan once, not narrate, and end with where the
  result is. The card hides the rest without asking more of it.

**The header is one line:** back, the title and ⋯ (Show every step, Delete chat). The model
picker leads with the agent's mark, the one place the chat names its agent.

**A tray hangs under the composer**, inset from its sides, with Skill and Review as quiet text
controls (their name muted, their value in the foreground). A chat that writes the code has none.

- **Skill** lists the design skill, the project's defaults and what this chat chose, each with its
  summary and "Default" beside the project's own. The project's other skills are under Other
  skills. Then No design skill, and Skill settings….
- A chat's choice is `Thread.skills`: `ultrapaint` and project skills by their files, set by
  `threads.setSkills`; null goes back to the project's defaults, and so does a choice equal to them.
- The briefing tells exactly the chosen skills. None is briefed as a chat not told the design
  skills: no skill, no design method.
- A change after the briefing went out leads the next prompt with a note of what is told now
  (`Thread.toldSkills` is what was told).
- A chat told no design skill is not reviewed unless its own review settings turn the review on.
  Picking No design skill sets the chat's review to Off. Picking a skill again gives the review
  back to the project.

## Consequences

- The run card no longer stands alone in the transcript; its steps are a section of the turn's card.
- The agent's words between its steps are read only by whoever opens the steps.
- The thread's scope bar is gone: its page is the card's, with Show.
