# Agents

## Agents stay in the repository

An agent you start here runs inside a sandbox: it reads the repository, its own files and the
toolchain, and writes nothing but the repository, its own files, the package caches and the
temporary directories. Your home directory is closed to it. That holds for the shell commands it
runs too, and it does not depend on the agent — it is the operating system's doing. Network is
open, because an agent has to reach its model.

This works on macOS, and on Linux when [bubblewrap](https://github.com/containers/bubblewrap) is
installed (`bwrap`). Elsewhere the agent runs with your own rights until the sandbox for that
platform lands.

An agent of your own, added as JSON under `~/.ultrapaint/agents/`, tells the sandbox where it
keeps its login and sessions:

```json
{
  "id": "my-agent",
  "name": "My agent",
  "command": "my-agent-acp",
  "stateDirs": ["~/.my-agent"]
}
```

## Agents ask the editor

An agent in a thread is told about the project when it starts — where the designs are, how pages
route, what the system and app components are — and is given the editor's own MCP server to ask the
rest: the pages and their routes, a component's props, variants and slots, the comments left on the
canvas (a big page as an outline first, then a part at a time). It can add and rename pages through
it, answer a comment where it was left, say which page it is working on so you can watch it, and
take a screenshot of a page or a node to check its own work. Screenshots are drawn by the editor's
preview, so the editor has to be open in a browser. When a decision is yours it asks you on a card
in the chat, and waits for your answers in the same turn; you can also decline. Any MCP server the
agent uses can ask you the same way.

It saves the agent from reading the repository to find out what the editor already knows. On four
tasks with the model pinned, two runs each, that was 32 tool calls on average without any of it,
24 with the briefing and 15 with the tools as well — and roughly half the time per task. On two
of the four the three arms do not overlap at all; on the hardest one they still do
([the measurements](../feature/benchmarks/), which say what they cannot yet tell apart).

An agent outside the editor can use the same tools: a terminal's Claude Code or Codex, or a chat
in another app such as T3 Code. Add Ultrapaint to it once, for every project
(**Settings** › **Agents** › **Connect over MCP** shows the same lines):

```bash
claude mcp add ultrapaint -s user -- ultrapaint mcp
codex mcp add ultrapaint -- ultrapaint mcp
```

Every tool asks the agent for the folder it works in (`cwd`), and that folder says which project:
the nearest `ultrapaint.config.json` from there upwards. So a hub that shares one `ultrapaint mcp`
among all your agents, such as mcp-hub, works too: give it `ultrapaint mcp` as a local server,
with the command's whole path, and have it skip the agents Ultrapaint starts itself, which have
the tools already (`"skipWhenEnv": "ULTRAPAINT_AGENT"` in mcp-hub). When the project is open in Ultrapaint,
the agent works on that editor's server, and what it changes shows there as it changes. When it
is not, the command starts the project's server without a window; opening the project then
attaches to it, and it stops once the agent and every editor on it are gone. A link the editor
copies (**Copy link** on a page or an element) names its project, so pasting one in a chat
anywhere, even in a folder with no project, has the agent work on that project from then on.
What you have selected in the editor is there for it too: "redesign what I've selected" works
while the editor is open on the project. The `ultrapaint` command has to be
on the agent's `PATH`: in the desktop app, the same Settings row offers **Install the command**
when this computer has none; from a checkout, `pnpm install:cli` ([Install and start](install.md)).

## Chats

While it works, what it changes shows on the canvas: the elements take the agents' pink, with its
name and what it is doing on their edge, and the text it is rewriting turns to placeholders until
it is done. A selection is blue, or purple when it is a component.

**Agents**, on the rail, lists your chats, each with a picture of what it works on, its last
line, and whether it is working or waiting for you; a search and a filter (**All chats**,
**Working**, **On this page**) narrow it. The selected element keeps a tag on the canvas with its
name and the agent's ✦ button, **Add to chat** (with ⌘ or Ctrl held, **Add to a new chat**). Its
controls are in the bar above the tools: what your design system offers for it, a component's
own variants, the text styles, the colour, radius, spacing and shadow tokens. Shift-click or draw
a marquee to select several, and set what they share at once.

The composer's **Attach** (+) attaches the selection or the page, a **Screenshot of the page**,
and **Add pictures or files…**; a picture or a text file pasted or dropped into the composer goes
with your next message too. What you send while an agent works is queued and goes when its turn
ends; after a turn that was stopped or failed, the queue waits for **Send now**. **Edit** on a
queued prompt takes it off the queue and puts its text in the composer, above what you had typed.

Right-click an element or a page's name to copy a link to it (**Copy link to element**, **Copy
link to page**; ⌘K, **Copy link to the selection**): it opens the editor on it, and an agent takes
it to find it, in the editor's chat or outside it, where the editor's MCP tools take it too. A
link copied from a page variant carries `variant=`. **Copy element ID** (`/orders#c_8x2k1q`) does
the same in fewer characters; on a variant's page it names the variant's file
(`orders@compact.page.json#c_8x2k1q`).

## Designs are reviewed

When a design chat's turn ends having changed pages, the editor has your **review models** look
at what it made ([ADR 0063](../adr/0063-the-design-chat-runs-the-method.md)). Each is a fresh
agent session that can only look. Their blockers and majors go back to the designer as its next
prompt, marked as the review's, and it fixes each or declines it with its reason; minor findings
stay in the round for you to read. Each round shows in the chat, and **Stop** stops it. A review
takes two rounds at most: a first look, then a second that checks the fixes.

How much review a design gets is its **review level**:

| Level | What it does |
|---|---|
| Off | No review. Not recommended |
| Quick | Your first review model looks, then checks the fixes |
| Standard | One review model looks, in turn; then all of them check the fixes |
| Thorough | All your review models look, then all check the fixes |
| Custom | You choose who reviews each round, who approves, and the goal |

**Settings** › **Agents** › **Review** sets the project's level and its review models, in the order
they take turns; with none chosen, the strongest model of each agent signed in reviews. The
composer's **Review** chip sets this design's own level on a slider, a dot saying it differs from
the project's; **Use project default** puts it back.

**Keep findings**, in **Settings** › **Preferences**, saves what review models find, in every
project, to `~/.ultrapaint/findings`, so the design skill can learn from it
([ADR 0066](../adr/0066-findings-are-kept-by-the-person-and-triaged-into-gaps.md)). It is your
choice, kept in your own profile rather than the project's configuration.
