# ADR 0124: A stop the agent ignores is forced

Status: accepted, 2026-11-24.

## Context

Stop asks the agent to cancel its turn (`session/cancel`) and lets go of the cards it waits on,
then waits for the agent to answer the prompt with `cancelled`. An agent that is hung, or deaf to
`session/cancel`, never answers: the thread stays `cancelling`, which is busy, so every prompt
waits in its queue and the agent cannot be switched until the editor is restarted.

The reference product waits 10 seconds for an agent to confirm a stop, then tells the person the
agent is not responding and offers to force it. It sets no inactivity timeout on a running turn
(neither for Claude Code nor for Codex): an agent thinking for a long time is not stuck.

## Decision

- **A stop is confirmed within 10 seconds or it is unconfirmed.** The first Stop of a turn the
  agent works on arms a wait of `STOP_CONFIRM_WAIT` (10 s) in the live session's scope; asking
  again does not put it off. If the turn has not ended by then, the thread's status moves from
  `cancelling` to `unresponsive`. The wait is disarmed the moment the status leaves
  `cancelling`, so a turn that ends and the next one stopped soon after never inherit it.
- **`unresponsive` is a thread status**, busy like `cancelling` (`isBusy`): the queue holds and the
  agent cannot be switched. It moves only through `statusAfter`, as every status does, and leaves
  for `idle` when the turn ends, by the agent or by force. A turn that ends from it ended
  cancelled (`turnEnd`).
- **Force stop** (`threads.forceStop`, `ThreadSession.forceStop`) acts only on an `unresponsive`
  thread and leaves any other as it is. It lets go of the cards the agent asked for since, which
  read No longer asked, ends the turn cancelled as the agent would have (`turn_end` with the
  files it changed), and closes the live session's scope, which stops the agent's process through
  the handle that spawned it, never by name or pattern. It runs under the thread's prompt lock, so
  no prompt takes the session it closes. The turn is ended at the agent in one step
  (`endAtAgent`), so an answer the agent sends meanwhile, or after, changes nothing.
- **The next prompt reopens the conversation.** The thread keeps its `sessionId`; the prompt
  starts a new session, which resumes or loads it (`session/resume`, `session/load`) as after an
  agent's exit. Queued prompts stay queued for the person to send or drop, as after a Stop.
- **The editor says it.** The composer shows, over itself, "The agent isn't responding." and
  Force stop, nothing more: the person chose the shorter note. `threadView` reads the status as `unresponsive`, and lists say
  *Not responding* in the attention tone: the person has something to do.
- **No inactivity timeout on a running turn**, as in the reference product.

## Consequences

- A hung agent costs the person 10 seconds and one click, not a restart.
- Force stop drops whatever the agent was doing in its process: a write half done stays as it is
  on disk, and the turn's end lists what changed.
- `cancelling` and `unresponsive` are both "being stopped" (`isStopping`, which `isBusy` and
  `turnEnd` read): whatever asks whether a thread is being stopped asks it, never one status.
