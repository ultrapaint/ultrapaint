# ADR 0118: Every thread writes the repository

Status: accepted, 2026-11-23. Amends 0013 (a design thread's sandbox), 0030 (a thread has a
purpose) and 0115 (an Update from code thread writes the designs directory only).

## Context

0030 gave a thread a purpose and made it a wall: a `design` thread's sandbox kept the repository
read-only but for the designs directory, and the editor refused its ACP writes outside it, with
"outside the designs directory: this thread designs". `/implement` in a design thread already
running was answered by telling the person to open another thread.

In use the wall stood in the way more than it protected anything. A design chat is the chat the
person has open, and what they ask of it does not stay inside `docs/designs`: a stylesheet, a
component the design names, the project's `DESIGN.md` at the root, a doc, a config. Each such
request was refused, and the person had to start an implement thread and say it all again. The
person asked on 2026-11-23 for the model to write outside the designs directory.

## Decision

- **A thread's agent writes the whole repository, whatever its purpose.** The sandbox around it
  is the one 0013 describes for every agent: the repository writable, its `.git` read-only. The
  editor's ACP writes follow the same line: anywhere in the repository, never in `.git`.
- **The purpose stays, as what the thread is for, not what it may touch.** A `design` thread is
  briefed that its work is the design and that it writes the rest of the repository when the
  person asks for it; behaviour asked for without its code is still a behaviour note. An
  `implement` thread is briefed to turn designs into code. The review loop still looks at design
  threads' turns only (0063).
- **`/implement` in a running design thread runs the task.** It keeps its purpose and briefing;
  a thread that starts with `/implement` is still an implement thread (`purposeFor`).
- **A reviewer stays confined.** A review model writes only its scratch directory, the
  repository read-only around it (0063): `writable` on a launch is now only that.

## Consequences

- `thread-session.ts` launches every thread's agent without `writable`; the sandbox's
  `rewritable` and the ACP check's `writable` serve the reviewer alone.
- The briefing's design role says the thread may write the rest of the repository when asked.
- `DESIGN_THREAD_IMPLEMENT`, the redirect to an implement thread, is gone.
- Without a sandbox nothing changes for writes: the ACP check never held the agent's own tools.
