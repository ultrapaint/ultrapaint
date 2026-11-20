# ADR 0109: A card the agent withdraws is no longer asked

Status: accepted, 2026-11-20. Amends 0022 (an agent waits for the user's answers).

## Context

Claude Code, through `claude-agent-acp`, puts every question to the editor as a form
(`elicitation/create`): its own AskUserQuestion and the editor's `ask_user` alike. It can withdraw
the request before the person answers (`$/cancel_request`), and from then on it no longer listens
for the reply: it withdraws a request a hook answered in the person's place, or one its work
stopped waiting on. Its adapter says so of a client that ignores the cancel: it "never sends" the
reply the SDK waits for.

The editor ignored it. The handler kept waiting, so the card stayed open as one the agent waits
on, after the turn had ended. Answering it resolved the handler and the reply went to a request
nobody was waiting on: no error, no prompt, nothing running. A person in the desktop app answered
a question at the end of a turn and the chat stayed stuck.

## Decision

**A withdrawn request stops its handler.** The ACP client runs the handlers of
`session/request_permission` and `elicitation/create` with the request's signal, which the SDK
aborts on `$/cancel_request`: the handler is interrupted.

**A withdrawn card says so.** A question reads `cancelled`, which the card shows as No longer
asked, and can no longer be answered: the agent is not listening, and an answer sent as a prompt
could be one it no longer needs, as when a hook answered in the person's place. A permission reads
`cancelled` too, and choosing on it says it is no longer pending. The person who still wants to
say what they would have answered says it in the chat.

## Consequences

A question the person meant to answer closes under them, but visibly: the card says No longer
asked, and the chat takes their words. No answer is lost without a word.

Considered: keeping the withdrawn question answerable, its answers sent as the next prompt once
the turn is over, as the card of an agent that cannot wait is. The person chose the card that
says the agent stopped asking, which never sends a prompt the agent did not ask for.
