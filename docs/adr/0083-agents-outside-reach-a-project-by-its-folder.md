# ADR 0083: An agent outside the editor reaches a project by its folder, through `ultrapaint mcp`

Status: accepted, 2026-11-12. Amends 0014 (how an agent outside the editor connects) and 0031
(a server the app did not start).

## Context

Every server has the editor's MCP server at `/mcp` (ADR 0014), and an agent outside the editor
could already use it: Settings › Agents showed a `claude mcp add --transport http` line with the
server's URL and the project's token. The person wants to ask for designs from a chat in T3 Code,
in any of their projects, and that line does not hold:

- The desktop app starts a project's server on a free port (`--port 0`, ADR 0031), so the URL
  registered with an agent is stale after a restart or a switch.
- An entry reaches one project. Several projects are several named entries, each carrying the
  whole tool list, against a budget that is already tight (ADR 0022).
- The app has one project open at a time; switching stops the other's server and its MCP.
- Several servers can run at once (the app, `pnpm dev`, the lab's hosts): a fixed URL can reach
  the wrong one.

Figma has two MCP servers. Its desktop app serves a fixed loopback address whose context is the
file open in it and what is selected there; its remote server takes links that name a file and a
node. A fixed address works for Figma because the open file is the one context there is. Here it
would not: an HTTP endpoint cannot see which folder a chat works in, and two chats in two
repositories would both write into whichever project the app has open.

## Decision

**One registration for every project: a command the agent starts.** `ultrapaint mcp` is a stdio
MCP server, registered once with an agent (`claude mcp add ultrapaint -s user -- ultrapaint mcp`,
and the same command in Codex's configuration). The agent starts it for each session, in the
folder the session works in, and stops it with the session. It holds no tools of its own: it
passes each message to the `/mcp` of the project's server and its answers back, so the tools are
the editor's and the same as a thread's agent gets.

**The folder says which project.** The command looks for `ultrapaint.config.json` from its
working directory upwards, as the server does, and reads the state directory beside it: the run
file (`run.json`, ADR 0031) for where the server is, and `mcp-token` for the project's token,
which the server now writes when it starts. Nothing about a port or a token is copied anywhere.
A port that changed is read again from the run file when a call fails to connect. A folder the
desktop app keeps a session for (one with no configuration file) is found through the app's
project list.

**A project with no server running is started, without a window.** The command starts the
project's server as the app does (`--port 0 --ready-json --stop-with-stdin`) and holds it; the
designs are files in the project, and the app or `ultrapaint` attaches to that server when the
project is opened. The editor keeps its server when the agent's session ends: a server an editor
is connected to outlives the stdin it was started with, and stops when the last editor leaves.

**A link names the project, for a chat in another folder.** The link the editor copies
(`…?canvas=redesign&route=/vibe&node=c_1`, AGENTS.md) also names the project's folder. Given such
a link, the command passes the calls to that project's server instead of the folder's. Tools that
take a page or a node take the whole link, as they take `/vibe#c_1` today.

**The selection is a place too.** "What I've selected" is what is selected in the editor open on
the project: a read-only tool returns it as node references, which every tool takes. It is the
one tool this adds, paid for within the budget test.

**The app puts the command on the PATH.** The desktop app's menu has **Install Command Line
Tool**, which links `ultrapaint` into a directory on the PATH (as VS Code's `code`); a checkout has
`pnpm install:cli`.

**Settings show the one-time line.** Settings › Agents › Connect over MCP shows the `claude mcp
add` line and Codex's, the same for every project, each with Copy. The URL with a port and a
token is no longer shown.

## Consequences

- One line of configuration serves every project, every restart and every chat; a design an
  agent makes lands in the project's designs and appears live in an editor open on it.
- The command must be on the agent's PATH; the app offers it, and the Settings row says how.
- An agent outside the editor has no thread: its edits show on the canvas, its presence does not
  (`focus` needs a thread). A presence for outside agents is left for later.
- The plan is `docs/plans/PLAN-outside-agents.md`.
