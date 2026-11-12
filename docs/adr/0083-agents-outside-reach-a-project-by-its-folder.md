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
A port that changed is read again from the run file when a call fails to connect. A folder with
no configuration file, which the desktop app keeps a session for in its own data, is not looked
for there: the answer says to save the configuration (Settings › Repository › Save to file…),
after which the folder is found like any other.

**Each call names its folder too, for a command shared by several agents.** A hub such as
mcp-hub starts one `ultrapaint mcp` for all its agents, in a folder of its own, and passes no
agent's folder along: MCP's roots, the protocol's way to say it, are deprecated in the 2026-07-28
revision, which says to pass folders as tool parameters instead. So every tool takes `cwd`, the
absolute path of the folder the agent works in, required. The command adds it to each tool it
lists and takes it off each call it passes on: the server's tools do not have it, and the
editor's own agents, which reach the server directly, never see it; the definitions an outside
agent reads grow by about 1,500 characters (39 tools; the parameter has no description, its
name says it). A call is for the project found from its `cwd` upwards; a call without one
(`initialize`, `tools/list`) is for the folder the command was started in. A `cwd` that is not
absolute is answered with why. Through a hub, a command stopped for being idle is started again
by the next call, and the servers it started go with it unless an editor is connected.

**A project with no server running is started, without a window.** The command starts the
project's server as the app does (`--port 0 --ready-json --stop-with-stdin`) and holds it; the
designs are files in the project, and the app or `ultrapaint` attaches to that server when the
project is opened. The editor keeps its server when the agent's session ends: a server an editor
is connected to outlives the stdin it was started with, and stops when the last editor leaves.

**A link names the project, for a chat in another folder.** The link the editor copies
(`…?canvas=redesign&route=/vibe&node=c_1`, AGENTS.md) also names the folder of the project's
configuration (`project=`), once it is saved. A call with such a link among its arguments goes to
that project's server, and so do the calls from the same folder after it, until a link names
another: an agent that read a page by its link goes on working on that page's project. A link is
remembered for the folder its call came from, so that two agents sharing one command, in two
folders, do not turn each other's calls. The tools take the whole link, as they take
`/vibe#c_1`. In a folder with no project, a hub's among them, the command offers the tools a
server listed, kept in the user's directory (`~/.ultrapaint/mcp-tools.json`): every server
writes its list there as it starts, and the command each list it passes on. A call before any
folder or link names a project answers why there is none.

**The selection is a place too.** "What I've selected" is what is selected in the editor open on
the project. The editor says its selection to its server as it changes (`editor.select`, once it
has stayed put a moment, and again when its connection opens anew), each node by the reference
the tools take and its name; an editor that closes takes its selection along. `get_context`
returns it as `selection`: no tool is added for it, and the tools' definitions grow by a few
words, within the budget test.

**The app puts the command on the PATH.** The desktop app has no menu of its own, so the offer
is where the lines are: Settings › Agents › Connect over MCP says when this computer has no
`ultrapaint`, with **Install the command**. It writes a launcher of the app's own server bundle,
run with Electron's binary as Node (in an AppImage, the AppImage itself, which finds the bundle
under `$APPDIR`), into the first folder on the PATH the user can write (`~/.local/bin`,
Homebrew's `bin`, `/usr/local/bin`); on a Mac with none, `/usr/local/bin` with the
administrator's password; on Linux, `~/.local/bin`, saying when it is not on the PATH. A checkout
has `pnpm install:cli`.

**Settings show the one-time line.** Settings › Agents › Connect over MCP shows the `claude mcp
add` line and Codex's, the same for every project, each with Copy. The URL with a port and a
token is no longer shown.

## Consequences

- One line of configuration serves every project, every restart and every chat; a design an
  agent makes lands in the project's designs and appears live in an editor open on it.
- The command must be on the agent's PATH, or the hub's; the app offers it, and the Settings
  row says how. A hub's PATH is usually minimal: its entry gives the command's whole path and a
  PATH with Node on it.
- Every outside agent passes its folder on every call, a cost in tokens the editor's own agents
  do not pay.
- An agent outside the editor has no thread: its edits show on the canvas, its presence does not
  (`focus` needs a thread). A presence for outside agents is left for later.
- The plan is `docs/plans/done/PLAN-outside-agents.md`.
