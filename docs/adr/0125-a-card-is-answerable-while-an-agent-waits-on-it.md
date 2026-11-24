# ADR 0125: A card is answerable exactly while an agent waits on it

Status: accepted, 2026-11-24. Amends 0022 (an agent waits for the user's answers) and 0109 (a card
the agent withdraws is no longer asked).

## Context

A person in the desktop app answered an agent's question and nothing happened: the agent carried
on, asked the same question again, and only the second answer was heard. Both cards read
Answered. Four things made it true:

- An agent can stop waiting on a form without withdrawing it. 0109 handles the withdrawal
  (`$/cancel_request`); a form the agent simply stops listening for stayed open, and answering it
  handed the answers to a request nobody waited on, and the card read Answered.
- When the agent asked again, the composer showed the oldest open card first, so the dead copy
  stood in front of the live one.
- A card left open when the server restarted stayed open for good: the thread read idle at start
  but its cards did not, and answering one failed with "the agent no longer waits for these
  answers".
- A card read Answered once the server took the answer, before it was written to the agent.

And nothing recorded when a card was opened or how it ended, so a stuck chat could not be
explained afterwards.

The reference product's thread management keeps each runtime request an agent makes as pending,
then resolved, expired or cancelled, settles at start whatever a restart left pending, and counts
a response as given once its write to the agent is acknowledged.

## Decision

**A card is answerable exactly while an agent waits on it, and otherwise says what became of
it.** `PendingCards` stays the one place a card's life is decided.

**The same questions asked again let the older copy go.** A form whose questions are an open
form's questions (the same ids, texts and options, in order) settles the older one: it reads
`cancelled`, No longer asked, and its request hears `cancel`. The agent waits on the newest. Two
different forms both stay open and are answered oldest first, as the reference product shows its
requests (a subagent's beside its parent's). This goes beyond the reference product, chosen with
the person.

**An answer reads as given once it is written to the agent.** The ACP client tells the handler of
`elicitation/create` and `session/request_permission` when its response has been written
(`Written`): true once the SDK's write went through, false when it failed, or when the agent
exited or the connection closed before it was made. A question's answers are recorded then; when
the write fails they are kept and the card reads `undelivered`, Delivery not confirmed, with a
line asking the person to say them again in the chat. A permission's pick is recorded once
written too.

**At start, every card left open is settled** (`ThreadStore`, where the thread is read idle): a
permission reads `expired`, never granted to an agent no longer asking; a question an agent waited
on keeps its card and gets `restartedAt`, so no agent waits on it any more and its answers go as
the thread's next prompt, as for an agent that cannot wait (0022). The settled cards are written
back, so a second restart finds them settled.

**Each card keeps its life in the thread.** It was opened at its `at`; `settled` says when it
stopped waiting and how: answered, declined, withdrawn (`$/cancel_request`), released (its turn
stopped or its session ended), repeated, expired or undelivered. All of it is optional, so threads
stored before read unchanged.

**A withdrawal still reads No longer asked** (0109), which the reference product does not do;
the editor keeps honouring `$/cancel_request`.

A replay agent (`@ultrapaint/acp/replay-agent`) plays a transcript of a real agent's messages
against the editor's own ACP client, the SDK included, at the agent launcher's seam beside the
scripted agent, as the reference product's recorded fixtures do. The first transcript is Claude
Code asking with `ask_user` through claude-agent-acp 0.95, written by hand from that version's own
messages where no session could be recorded; a recorded one replaces it as is.

## Consequences

An answer never goes to a copy nobody waits on, and Answered means heard. A restart loses no
question: its answers arrive as a message. A permission open at a restart has to be asked again by
the agent, which is the safe way round.

The answer request waits for the write, which is a write to the agent's input and takes no time
while the agent runs. Written means handed to the agent's input: an agent that dies before its
exit is seen may never read an answer that reads Answered.

Considered and rejected: one answer delivered to every identical open copy (the agent could act on
it twice), and keeping thread events in a SQLite store as the reference product does (the person
chose its behaviour on the per-thread JSON files).
