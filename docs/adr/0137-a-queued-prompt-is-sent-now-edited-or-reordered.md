# ADR 0137: A queued prompt is sent now, edited or reordered

Status: accepted, 2026-11-24. Amends 0018.

## Context

0018 has a prompt sent while the agent works wait in the thread's `queued` list. It goes when the
turn ends by itself, and after a turn that was stopped or failed it waits for the person's Send
now. The chat showed the queue as a card over the composer, "1 queued, sent when this turn ends".
Edit and Remove showed only under the pointer, and Edit took the prompt off the queue and merged
it into the draft. The person could not get a correction to the agent before the turn ended, nor
change the queue's order.

Both agents the editor ships take a prompt into the turn they work on. ACP's steering extension
(`_session/steering`) does it, and each says so in `initialize`'s own `_meta.steering.supported`.
The Claude adapter injects the prompt at once (priority `now`), which cancels a tool call in flight
and reports it as refused. The reference product delivers a steer after the running step instead.
Its queue has Send now, Edit (in the composer) and Remove under each bubble, and it steers by
default on Enter. The person chose its design and behaviour in the deck of 24 Nov. Reordering and
the edit hold are theirs: the reference product has no reordering in its chat, and sends a prompt
that is being edited when the turn ends.

## Decision

- **A queued prompt is a dashed, unfilled bubble at the end of the chat.** Its words and pictures
  show, with Send now, Edit and Remove under it, in view at rest. No line goes over the queue:
  the bubbles say "not sent yet", and a screen reader hears "N queued prompts". Past three, the
  first two show and the rest fold under "Show all N queued".
- **Send now** (`threads.sendQueued` with the prompt's id, `ThreadSession.sendNow`) depends on
  where the thread is:
  - **A turn runs:** the prompt goes into it. It moves to the head of the queue, marked
    `steering` ("Steer · waiting to be read", still to be edited or removed), and reaches the
    agent once no tool call of the turn is running (`Turn.stepEnded`), so nothing in flight is
    cut off. Once the agent has it, it leaves the queue for the transcript as a user item marked
    `steer`, which the chat draws in the turn it joined, under its prompt, with a *Steer* note.
  - **The turn ends first,** or the agent has no turn to put it in (`noTurn`): the prompt waits
    at the head of the queue. The turn's end sends it, or after a stop it waits for the person.
  - **An agent that does not say it steers:** its turn is stopped, and the prompt starts the next
    one.
  - **A review round runs:** the round stops, and the prompt goes to the designer in its place.
  - **No turn runs**, after a stop or a failure: the prompt starts a turn.
  - **The agent is being stopped:** Send now is refused, and the chat does not offer it. A steer
    still waiting for its step when Stop is pressed waits for the person, first in the queue.
  - **A steer on its way:** until the agent answers, the turn's end does not send that prompt as
    a turn of its own, so the agent has it once.
- **Enter sends a follow-up now, and ⌘Enter queues it**, while the agent works. A setting, *While
  the agent works: Send now · Queue*, swaps them. It is kept in this browser beside the send key.
  Where ⌘Enter is the send key, ⌘⇧Enter does the other. The send button's label and tooltip say
  which one, and its label turns while ⌘ is held. The composer's prompt carries it as
  `followUp: "steer" | "queue"`.
- **Edit happens in the composer, and the queue waits.** `threads.editQueued` has three actions:
  - `start` marks the prompt `editing`. Nothing the queue sends by itself goes while one is
    being edited, not even what waits behind it, even when the turn ends. A prompt the person
    sends now goes all the same: they pressed it. One whose steer is on its way to the agent
    cannot be opened until the agent has answered.
  - `save` gives it its new words and attachments.
  - `save` or `cancel` lets the queue go on where only the edit held it.

  The composer sets the draft and its chips aside, shows the prompt's, and reads Update, and
  Escape lets the edit go. The draft comes back either way. A prompt that leaves the queue
  some other way while being edited keeps the edit in an empty composer and drops it over a
  draft, as the reference product does.

  An edit no window has open any more (the window closed or reloaded) reads "Being edited",
  with Cancel and Edit, so it never holds the queue out of reach. A restart lets every edit
  and every waiting steer go (`queueAtRest`).
- **A review round the person stops holds the queue**, as a stopped turn does: an edit finished
  afterwards sends nothing.
- **The person orders the queue.** Its prompts are dragged by a grip, and ⌥↑ ⌥↓ on the grip move
  one a place (`threads.moveQueued`). In an empty composer, ⌥↑ edits the last queued prompt and
  ⌘⇧Enter sends the first one now.
- **A steer is a prompt the person sent** (0074). `agent.steer` is listed with its reason beside
  `agent.prompt` in the server's guard, and the editor's files that send a queued prompt now are
  listed in its guard.

## Consequences

- A correction reaches the agent within a step of being sent, and a running edit is never cut
  in half.
- A turn can hold several of the person's prompts, so a turn card shows each one under its first.
- A prompt being edited holds the queue until it is saved or let go. A person who leaves an edit
  open has to come back to it before the queue moves.
- Codex answers a steer with no turn running by starting a turn itself, whatever the host asks.
  Ultrapaint steers only while its own turn is at the agent, which leaves that case to a race.
