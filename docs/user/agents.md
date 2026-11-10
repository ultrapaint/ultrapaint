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
route, what the system and app components are — and is given the editor's own MCP server to ask the rest:
the pages and their routes, a component's props, variants and slots, the comments left on the canvas
(a big page as an outline first, then a part at a time). It
can add and rename pages through it, answer a comment where it was left, say which page it is
working on so you can watch it, and take a screenshot of a page or a node to check its own work.
Screenshots are drawn by the editor's preview, so the editor has to be open in a browser. When a
decision is yours it asks you on a card in the chat, and waits for your answers in the same turn;
you can also decline. Any MCP server the agent uses can ask you the same way.

While it works, what it changes shows on the canvas: the elements take the agents' pink, with its
name and what it is doing on their edge, and the text it is rewriting turns to placeholders until
it is done. A selection is blue, or purple when it is a system component.

**Chats** lists your chats, each with a picture of what it works on, its last line, and whether it
is working or waiting for you. The element you select has a toolbar over it with what
your design system offers for it — a component's own variants, the text styles, the colour,
radius and spacing tokens — and a button that adds it to the chat. Shift-click or draw a marquee to
select several, and set what they share at once. Paste an image into the chat's box (a screenshot,
or image files copied) and it goes with your next message as a picture. What you send while an agent works waits in the
thread and goes when its turn ends. Right-click an element or a page's name (or press ⌘K, **Copy
link to the selection**) to copy a link to it: it opens the editor on it, and an agent takes it to
find it, in the editor's chat or outside it, where the editor's MCP tools take it too. An
element's ID (`/orders#c_8x2k1q`) does the same in fewer characters.

It saves the agent from reading the repository to find out what the editor already knows. On four
tasks with the model pinned, two runs each, that was 32 tool calls on average without any of it,
24 with the briefing and 15 with the tools as well — and roughly half the time per task. On two
of the four the three arms do not overlap at all; on the hardest one they still do
([the measurements](../feature/benchmarks/), which say what they cannot yet tell apart).

An agent outside the editor can use the same tools: **Settings** shows the line that adds it.
