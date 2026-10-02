# ADR 0014: The editor answers agents over MCP

Status: accepted, 2026-09-21.

> Amended by [0015](0015-design-documents.md), 2026-09-25. Pages are no longer source, so the
> editor does offer the way to edit them: `read_page`, `read_canvas`, `get_document_format` and
> `apply_operations`, the same operations the inspector makes, validated and undoable. The design
> system has `scan_design_system`, `read_design_system` and `write_design_system`, for `/init`.

> Amended by [0018](0018-agents-work-on-the-canvas.md), 2026-09-29. `focus` also takes the
> `nodes` about to change and the `action`; `apply_operations` from a thread publishes the nodes it
> touched, which the canvas draws as the agent's work. `set_frame` sizes a page's frame. A node
> reference (`/orders#c_8x2k1q`) is taken wherever a route or a node id is.

> Amended by [0022](0022-mcp-2026-and-asking-the-user.md), 2026-10-02. The server speaks MCP
> 2026-07-28 first; the tools' definitions are cut to about half of what an agent carries;
> `ask_user` answers "input required" with a form, which the editor draws as a card the agent
> waits on within its turn.

## Decision

The server hosts an MCP server on its own port at `/mcp`, built on Effect's `McpServer` over
Streamable HTTP. It offers what the editor knows and nothing else:

- Reading: `get_context`, `list_pages`, `read_page`, `list_components`, `get_component`,
  `list_comments`.
- Doing: `create_page` and `rename_page` (a page's route is its path, so the editor puts the file
  where the route says), `reply_to_comment` and `resolve_comment` (the user asked in a thread on
  the canvas; the answer belongs there), and `focus`, with which an agent says which page it is
  working on.

File edits are deliberately not offered. Agents are good at editing source, they do it through
their own tools inside the sandbox of ADR 0013, and a second way to write the same files would
be a second thing to keep right. What the editor offers is what an agent cannot work out for
itself, or cannot do at all: what the project is, and where it is working.

Every agent of a thread is told about the server when its session opens, as an ACP `mcpServers`
entry with a token of its own. The project briefing names the tools, because a tool nobody knows
about is not used — and says that what `get_context` and `list_pages` would return is already in
it. Both agents otherwise opened every run by asking for what they had just been told; after the
change, two Codex runs did not call `get_context` at all, where all nine before had. An agent
outside the editor gets no briefing, and the tools are there for it.

A tool that cannot answer says why, in words the agent can act on — "no page at /x; call
list_pages to see the routes". The failure is an error class: Effect's MCP server passes a
failure's message on only when it is an `Error`, and until the review of this branch every one
of them reached the agent as "internal server error".

A project can have several spaces (canvases since [0019](0019-canvases.md), and the tools
take `canvas`), and a route can be a page in more than one. A tool that
needs a space and is not told one works in the only space there is, or asks which; one that is
given a route two spaces share asks which as well. It does not pick the first. The designs
directory's own space is called `""`, which is a name like any other.

## Access

A call carries a token in `x-ultrapaint-token`, checked by a middleware in front of the
endpoint. Two kinds:

- **A thread's token**, issued when the session opens and revoked when it closes. It says which
  thread is calling, which is how `focus` reaches the right agent's presence on the canvas.
- **The project's token**, kept in the state directory, for an agent outside the editor. The
  settings show the `claude mcp add` line that uses it.

The server listens on loopback, but so does every page in the browser: without a token any
website the user has open could call these tools.

## What is measured, and what is not

Four tasks, in `docs/feature/benchmarks/2026-09-source-pages/`. Measured first on a session left on "auto", the numbers
moved by about twofold between repeats of the same task and could not be told apart. Pinned to
Opus 5 and measured again, two runs of every task in every arm: 32.4 tool calls on average as the
tool was, 23.5 with the briefing, 15.1 with the tools as well, and roughly half the wall time.

The spread is the interesting part. On two of the tasks the three arms do not overlap at all —
using a component known to the catalogue costs 28–34 calls bare, 15–19 briefed and 5–8 with the
tools; linking two routes, 29 and 29, then 18–25, then 8 and 9. Making a page separates the tools
from the rest but not the briefing from the baseline (30–41, 28–33, 17–24). Building a form out
of unfamiliar components is wide in every arm (26–42, 18–32, 14–36): it is the task that varies,
not the arm, and no reading of two runs of it is worth much.

Codex, pinned to "6 Astra", tells a different story, and a useful one. It is frugal by habit —
twelve calls on average with nothing, where Claude Code takes thirty-two — and the briefing is
what it needs: without it, five runs of eight came out wrong (a page in the wrong place, a link
that bypasses the space's router); with it, none did, in seven calls on average. The tools do
not cut calls further for Codex: 10.4 on average, since it calls `get_context` for what the
briefing already said, `focus` for the canvas, and `read_page` to check its own work. They cost
it little and keep every run correct, and `focus` is what puts its presence on the canvas at
all. So the briefing stays on for every agent, and the tools are there for the agents that
use them to save work, and for the canvas.

Codex's token counts, a few tens of thousands a run, are what codex-acp reports, which leaves out
what Claude Code counts as cache reads; they are not comparable with Claude Code's.

Two runs to a cell is still thin, and the arms are not alternatives — the briefing is what makes
an agent reach for the tools at all. What the traces show is agents asking instead of hunting:
257 shell calls across the baseline against 83 with the tools. Every run in every arm produced
correct work.
