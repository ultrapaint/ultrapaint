# ADR 0014: The editor answers agents over MCP

Status: accepted, 2026-09-21.

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
about is not used.

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

Four tasks, in `docs/feature/benchmarks/`. Measured first on a session left on "auto", the numbers
moved by about twofold between repeats of the same task and could not be told apart. Pinned to
Opus 5 and measured again, seven runs to an arm: 31.1 tool calls on average as the tool was, 22.9
with the briefing, 13.9 with the tools as well, and roughly half the wall time.

The spread is the interesting part. Two of the tasks have two runs in every arm and the arms do
not overlap — using a component known to the catalogue costs 28–34 calls bare, 15–19 briefed and
5–8 with the tools; linking two routes, 29 and 29, then 18–25, then 8 and 9. Building a form out
of unfamiliar components is wide in every arm (26–42, 18–32, 14–36): it is the task that varies,
not the arm, and one run of it cannot be read as a result. The remaining task has one run per arm
and is there to be repeated.

The arms are not alternatives — the briefing is what makes an agent reach for the tools at all.
What the traces show is agents asking instead of hunting: 217 shell calls across the baseline
against 67 with the tools. Every run in every arm produced correct work.
