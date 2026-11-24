# ADR 0141: A chat is settled, renamed and grouped from the list

Status: accepted, 2026-11-24. Amends 0132 (the chat list's rows, grouped by day).

## Context

The chat list kept every chat a designer started, newest first under Today and Earlier, and a
chat they were done with stayed in the way of the ones that needed them. From a row they could
open a chat, or right-click it to follow it, stop its turn or delete it. Chats copy T3 Code's
threads, whose list swaps a row's status for **Settle** on hover, puts settled threads aside and
groups the rest by state. The designer decided the follow-up to ADR 0132 in its deck (cards 5–8)
and agreed the seams (UP-187).

## Decision

**A settled chat is put aside, and comes back when it needs the designer.**

- `Thread.settledAt`, kept in the thread's file, set and cleared by `threads.settle`. It is
  cleared too when a prompt is sent to the chat, whether it starts a turn or waits in the queue
  behind one (the thread's session), and when the agent opens a question or a permission card or
  the turn fails (the thread store): what needs the designer never stays hidden.
- Nothing settles a chat on its own: no settling after idle days, nor on a merged pull request.
- Settling a chat, or renaming it, keeps its `updatedAt` (`ThreadStore.update` with
  `news: false`): a change the designer makes to the chat's place in the list is no news of it,
  so it neither moves nor reads Done. Every change moves `changedAt`, news or not: it is what an
  editor compares to tell the later of two copies of a thread (a list read against the events
  it heard), where equal `updatedAt`s could not.

**The row's actions.** On hover, or once the keyboard reaches the row, its state gives way to
**Settle** (Un-settle on a settled chat) and, while its composer holds a draft, **Discard draft**,
whose toast offers Undo. The row's right-click menu adds **Rename…**, which edits the title in
place (Enter sends it through `threads.rename`, which sets `named` so the agent's suggested
titles leave it; Escape keeps the old one; an empty title is refused), and **Mark unread**, which
sets the chat's seen time to just before its last change. Both are offered only on a row of the
list, where the title can be edited. Snooze and Pin are not taken from T3 Code.

**Grouping is the designer's**, as **Group chats** in Settings › Chats, kept in `profile.json`
with their other preferences (ADR 0093): **By state** (the default, as T3 Code: what needs them or
finished on top with no heading, then **Working** with its count, then **Settled**), **By day**
(Today, Earlier), **By page** (a group per page, then No page) or **None**. Settled is last in
every grouping, closed until opened; Working folds too, and each stays as the designer left it
while the editor runs. A search looks through settled chats and shows their group open.

## Consequences

- The list no longer groups by day unless the designer chooses it.
- A settled chat comes back with its `updatedAt` moved by the change that brought it back, so it
  reads as news (Your turn, Working, Stopped) where it lands.
