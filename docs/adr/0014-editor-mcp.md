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

Four tasks, in `docs/feature/benchmarks/`. The first run of each arm read as 30.5 tool calls
without the briefing, 21.0 with it and 10.8 with the read tools as well. Repeating the last arm
nine times put it at 26.1 (10 to 37): one run of a task is a sample of a noisy thing, and those
first numbers were a lucky one.

What the traces do show is agents asking rather than hunting — `get_context`, `list_pages`,
`create_page`, `get_component` — and every run in every arm produced correct work. The tools cost
little, are read-only but for the four that do what an agent cannot, and `focus` buys something
no amount of file reading would. That is the case for keeping them; the size of the saving is
still to be measured, with the same repetitions on every arm.
