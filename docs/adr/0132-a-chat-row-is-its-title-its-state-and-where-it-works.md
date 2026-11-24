# ADR 0132: A chat's row is its title, where it stands and where it works; the agents' pink is the canvas's

Status: accepted, 2026-11-24. Amends 0018 (chats are a list first; pink is an agent's status in
the chat too) and 0095 (the model picker's mark).

## Context

A row of the chat list held a picture of what the chat works on, its title and age, the agent's
last line, the agent's mark in its brand colour with where the chat works, and a status. The
person found it verbose and the state hard to read, asked for the state said plainly as T3 Code's
thread list says it, for an unsent draft to show, and did not like the agents' pink on every row
and spinner. They chose from a deck of mocks drawn in the running editor
(`artifacts/txm777e4m7`): row C, the pen before the title, the pink kept on the canvas, the
states as proposed.

The picture, 44 px of a whole page, could not be read; it was dropped from the row.

## Decision

**A row is two lines: the title with where the chat stands at its right, then where it works.**

- The first line: a pen when the chat's composer holds something not sent (tooltip *Draft not
  sent*; another pen than New chat's), the title in the list's name weight, then the row's state; the second, muted: where the chat works (the node and
  its page's URL), or *Nothing attached*.
- The state is a word with an icon, the most urgent first, as T3 Code's thread row orders it
  (`rowState`):
  1. **Your turn** (a question mark, the warning colour): a question or a permission waits.
  2. **Not responding** (an hourglass): a stop the agent ignored (ADR 0124).
  3. **Working 9m** or **Reviewing 9m** (a spinner, muted): the turn under way, timed from the
     person's last prompt (`summary.since`; a review round's findings sent on stay in its turn).
  4. **Stopped** (an alert, the destructive colour): the agent stopped on an error, until the chat
     is opened.
  5. **Done** (a check): a turn finished since the chat was last opened.
  6. Otherwise the age, muted: *3h*, *2d*.
- The agent's last line is no longer shown; the search still finds a chat by it.
- The list's own unread dot is gone: *Done* says it.

**The agents' pink is the canvas's alone.** It marks an agent's work on the elements, its name
tag and the board's button to ask one (ADR 0018's selection colours), as `--agent`'s own comment
already said. Elsewhere what said an agent works is neutral: the list's and the transcript's
spinners and the turning mark at the foot of a chat in the muted text colour, the rail's dot on
Chats, a plan step's dot, a setup step's badge and a finished chat's notice in the text colour,
a tab's spinner muted as when it opens. Every agent's mark is drawn in the colour of the text
beside it, Claude's as Codex's was.

## Consequences

- `Thread.summary` carries `since`, the person's last prompt, computed with the rest when the
  list is read and as the transcript grows.
- The picture of what a chat works on is drawn for the turn's card alone (`ScopePicture`, which
  refreshes its own).
- Grouping the list, settling a chat and the actions a row shows on hover were decided in the
  same deck and come as their own story.
