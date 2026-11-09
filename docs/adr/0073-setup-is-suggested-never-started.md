# ADR 0073: A folder's setup is suggested, never started on its own

Status: accepted, 2026-11-09. Amends 0062 (setup is a chat).

## Context

0062 made setup a chat: a folder opened for the first time, its settings detected and not saved,
started a chat titled "Set up <folder>" and sent it `/setup` as the editor opened, behind the
start screen's prompt when there was one. Every editor opened on such a folder ran an agent turn
on the person's account without being asked: an ephemeral server, which keeps no chats, ran one
at each start. The person found that wrong: the editor may suggest the setup, never start it.

## Decision

- **Nothing starts the setup on its own.** Opening the editor sends no prompt and creates no chat
  (`setUpOnOpen` and `startSetup` are gone).
- **It is suggested** while the folder's settings are detected and not saved: the Agents list with
  no chats says so and offers **Set up <folder>**, which opens a new chat with `/setup` in its
  composer, and a new chat's starters offer the same row first. Either way the person sends it.
- Setup stays a chat, an ordinary one in the Agents list, as 0062 has it.

## Consequences

- A folder can stay unset while the person designs on it; the title bar's warning and the settings
  still say its settings are detected and not saved.
- The Onboarding canvas (`docs/designs/onboarding/`) draws the setup chat opening by itself (3b);
  it is a record of the flows as 0062 decided them.
