# ADR 0130: A chat follows its thread by sequence, and a request sent again acts once

Status: accepted, 2026-11-24. Amends 0044 (how the editor orders a read with the news, for the
transcript of the thread open in the chat).

## Context

The editor showed the thread open in the chat from a read of its transcript (`threads.items`)
and the `agent` events, which carry no numbers. It took each event "as far as it is news", and
read the whole transcript again when it noticed an event that did not follow what it held. Nothing
told it what it missed while it was disconnected. A card the server settled meanwhile could stay
open, and an item could show twice or not at all when the read and the events crossed. Nothing
stopped a request sent twice (a retried answer, Send or Stop) from acting twice either. The
reference product keeps a chat in step with its thread by numbering each thread's events, and
answers a command it has already handled with its first result.

## Decision

- **Each change to a thread has a number, the thread's sequence.** `ThreadStore` numbers each
  change: an item added, an item updated, the thread's own change, a streamed chunk. It numbers
  and tells a change in one step, so a change is never told after a later one. The sequence is kept
  in memory and in the thread's file (`sequence`). A file written before has none and starts at 0.
- **A thread is followed as a stream, `threads.follow`.** Given `afterSequence`, the stream sends
  the changes after it while the store still holds every one of them. The store keeps a thread's
  last 128 changes since the server started, and sends them only while they come to 1 MB at most,
  the reference product's bounds. Otherwise, with no `afterSequence`, or with one past the thread's
  last change, the stream sends a `snapshot` of the thread and its items at its sequence. Then it
  sends `synchronized`, and each change as an `event` as it is made. It subscribes before it reads
  the thread and tells live only the changes past what it read, so no change falls between the two.
  It ends when the thread is deleted.
- **The editor follows the thread open in the chat, and only that one.** It keeps the last
  sequence it applied (`applied`) and drops a change at or below it. A snapshot replaces the items
  it held. The connection starts the stream again at every open, from the last sequence applied.
  Going back to the list stops following the thread, and opening it again follows it from a
  snapshot. The other threads keep taking the `agent` events as far as they are news, which keeps
  the list's summaries and the changed-files badge live. Their transcripts are put right by a
  snapshot once they are opened. The editor no longer reads a transcript again when it notices a gap.
- **A request that changes a thread carries a command id.** These are `threads.answer`, `decline`,
  `permission`, `prompt`, `unqueue`, `sendQueued` and `cancel` (`commandRequests`). The editor's
  connection makes the id. When the socket drops under such a request, the connection sends it
  again with the same id once the socket opens, waiting up to 10 seconds. `ThreadSessions.command`
  runs the request detached from its socket and keeps its result by its id. It keeps the last 256,
  in memory. A request sent again is answered with the first one's result, success or failure, and
  does nothing.
- **The numbers are of a run of the server's.** Each start of the server takes its own `run` id,
  which the snapshot and `synchronized` carry and the editor sends back with `afterSequence`. A
  server killed outright loses up to a quarter second of a thread's changes (its file is written
  250 ms late) and gives their numbers to new changes, so numbers from another run are not
  trusted: an editor resuming from one gets a snapshot, even when the numbers line up. The person
  chose a snapshot per restart over a rare stale transcript.
- Rejected: an event log in SQLite with projections, the reference product's store. The person
  kept the per-thread JSON files.

- **A list read keeps a newer row.** The list the editor reads as its connection opens is
  answered after the events that followed it; a thread whose row it holds is newer
  (`updatedAt`) keeps that row, so a reconnect never takes a thread's status or queue back.

## Consequences

- A reconnect to the same run costs the changes missed, not the whole transcript. Every restart
  costs the open thread one snapshot, as its numbers are another run's.
- A server killed outright loses the last quarter second of a thread's changes, as before; the
  editor's snapshot after the restart drops them from the chat too.
- The command results are in memory: a request sent again after a restart acts again.
- `threads.items` stays for the server's tests and harness. The editor no longer reads it.
- Pages, canvases and the other events keep their own streams.
