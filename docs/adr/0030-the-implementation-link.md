# ADR 0030: Designs are linked to the code that implements them

Status: accepted, 2026-10-25. Amends 0013 (a design thread's sandbox), 0014 (one more tool, and
the server's instructions), 0015 (`/implement`), 0019 (page states beside variants) and 0021
(links name states). Plan: `docs/PLAN-design-source.md`.

## Context

`/implement` put a page's whole tree in a prompt and kept nothing: the next change to the design
started again from nothing, a change to the code was never seen, and a request about behaviour
("only admins can delete") made while designing went into a chat that could not act on it, or
acted on the application's code from a thread that was meant to design.

The tool will not run the application: no mocks, no data, no login, no reading code back into
designs. What it keeps is the link.

## Decision

**A binding says what implements a design.** `implementation.json` in the designs directory has,
per page (by its id) and per component spec:

- `ready`: the design is ready to be implemented;
- `files`: the repository files that implement it;
- `design`: the hash of the design as it was implemented, its behaviour notes included;
- `code`: each file's hash then;
- `at`: when.

The design as it was implemented is kept beside it, in `_implemented/`, so the next
implementation is told what changed. Both are committed.

**The status follows.** No binding: draft, or ready once marked. Bound: implemented while both
hashes hold, *design changed* when the design's moved, *code changed* when a file's did; both can
hold. Code that changed is only a flag: the tool does not redraw the design from it.

**`/implement` is incremental.** For a bound design the task carries the node diff since it was
implemented (`diffTrees`: added, removed, moved, changed fields), the open behaviour notes, the
page's states and links, and the files that implement it; then the whole design. It ends by
marking the design implemented with the files it wrote, through `handoff`.

**Behaviour is written down, not drawn.** A comment can be a behaviour note (`kind:
"behaviour"`): pinned to a node, shown apart from discussion, never executed or mocked. A design
thread asked for behaviour writes one; `/implement` carries them.

**States are pages.** `orders@empty.page.json` is the orders page in its empty state when `empty`
is in the canvas's `states`; a variant (0019) is a prototype-wide alternative, a state belongs
to one page. A link can name a state's file, so a button can open the dialog state.

**A thread has a purpose.** `design`, the default, may write the designs directory only: its
sandbox makes the rest of the repository read-only, and the editor refuses its ACP file writes
outside it. `implement` writes the repository. `/implement` starts an implement thread. Where
there is no sandbox, only the ACP check and the briefing hold, and the thread says so.

**External agents pull from the same link.** One MCP tool, `handoff`: `list` (what is ready or
changed), `read` (a design's implementation task, as `/implement` writes it), `mark` (implemented,
with its files), `note` (a behaviour note, or a flag that the code moved away from the design).
The server's MCP `instructions` say when to use it; an agent outside the editor gets them when it
connects.

## Consequences

- The Pages panel shows each page's status; the inspector shows the binding, what changed, and
  marks a page ready or implemented.
- Deleting or renaming a page moves its binding and snapshot with it.
- The tool budget of 0022 holds: `handoff` fits because descriptions elsewhere were cut.
- Behaviour notes are comments: the comment tools and the Comments panel see them, with their
  kind.
