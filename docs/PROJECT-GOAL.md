# Project goal

Build a local-first design tool for teams that work with coding agents.

## What it must do

- **Live in the repository.** The tool runs locally against a code repository. Design
  work is saved to files and folders inside that repository, configurable in settings,
  so design and front-end code are versioned together and can ship in the same PR.

- **A Figma-like editor whose canvas is the real web UI.** The layout is familiar from
  Figma: a toolbar, a layers panel on the left, a property inspector on the right, and a
  canvas in the middle. But the canvas is not a vector document. It renders our screens
  with our own design system — its theme and its React components — live and clickable.
  There is no pixel-perfect drawing surface.

- **An infinite, navigable canvas with many screens at once.** The canvas pans and zooms
  like Figma. Multiple screens sit side by side on the same surface so a whole flow or
  wizard can be seen and worked on together, not one screen at a time. Each screen is
  still the real React UI. Behind the scenes this is web rendering, with each screen
  positioned and scaled on the surface, not a pixel canvas.

- **Canvases, as Figma has pages.** Wireframes, components, logos, a second version of the
  application: each is a canvas of its own, with its own pages and routes, listed above the
  pages and opened one at a time. Canvases and pages are copied between them, by hand or by an
  agent that changes the copy, and a snapshot names a point in the designs' history
  ([ADR 0019](adr/0019-canvases.md)).

- **Layers are the design.** The layers panel shows the whole canvas, as Figma does: every
  page with its tree of rows, columns, groups, text, images and design-system components,
  and the nodes placed on the canvas beside them. Selecting a layer selects the element
  on the canvas.

- **The inspector edits real values.** The right sidebar shows the selected element's
  actual properties with a Figma-quality UI: padding and margin fields, font family in a
  dropdown, font size, weight, line height, colors, sizing, layout. Values are the
  design system's tokens where it has them, component props are the component's own,
  and the canvas updates immediately.

- **Design with our real components.** Screens are composed from our design system, not
  generated HTML. Component props are editable in the inspector, and the design system
  is the palette for inserting new elements.

- **Agent-native through ACP.** Agents connect over the Agent Client Protocol (ACP), so
  the tool has one agnostic agent API and no provider-specific integration code. Claude
  Code and Codex are the first agents; any ACP-speaking agent, including Gemini CLI or
  local models behind an ACP adapter, can be added without touching the editor. Multiple
  chat threads can work on the design at the same time, each with its own agent. Cloud
  agents are allowed, but the tool itself needs no cloud service to run.

- **Iterate fast, in real time.** Agent edits and manual inspector edits both appear
  immediately on the canvas. Humans and agents work on the same screens, taking turns
  or in parallel.

## Storage format

- **A design format of its own, not code.** Screens started as React source files; once
  the editor worked end to end they moved to a dedicated, generic format: JSON documents
  of pages, rows, columns, groups, text, images and design-system component instances,
  styled with the design system's tokens. They are text and live in the repository. An
  agent turns a finished design into the application's own code
  ([ADR 0015](adr/0015-design-documents.md)).

## Architecture

- **Web UI and backend are strictly separated.** The editor is a pure web application
  that talks to a local backend over a well-defined API. The backend owns everything
  that touches the machine: the repository filesystem, git, the dev server for the
  preview, code parsing and edits, agent processes, and credentials. The web UI never
  accesses these directly.

- **Follow the T3 Code repository structure.** T3 Code already solves this split for a
  local agent tool: a web app and a local server sharing one codebase. During
  implementation, study how that repo divides packages, defines the API between web and
  server, and shares types, and use the same structure and conventions here.

- **A command run in the repository, and the browser.** The tool is started where the
  repository is, the way a dev server is, and serves the editor to the browser. Because the
  UI is a plain web app, another shell could serve it later without changes to the editor
  itself; a shell would add native integration only, not features. The Electron shell that
  once existed was removed ([ADR 0017](adr/0017-a-command-in-the-repository.md)).

- **ACP is the only agent interface.** The backend hosts agents as ACP sessions: it
  spawns the agent process, relays prompts, streams updates and tool activity to the
  thread UI, and handles permission requests. Agent-specific details such as binaries,
  authentication and model lists stay in a thin per-agent launch configuration. Nothing
  above the ACP layer knows which agent is running.

## Future

- **Figma interchange.** Export screens to `.fig` and import from `.fig` files, if the
  tool proves itself. The architecture should not prevent it.

- **MCP.** Expose the editor to external agents as an MCP server, and let agents use
  MCP servers inside threads. Not part of the first build; ACP covers the agent
  connection until then.

## What it is not

- Not a cloud product with accounts, hosted sandboxes, or proxied API keys.
- Not a vector or pixel-perfect drawing tool. No freeform illustration, no prototyping
  layer separate from the code.
- Not a tool that stores design in a binary format or outside the repository.
- Not a UI that is coupled to one runtime. No Electron-only or browser-only features in
  the editor.
- Not a collection of per-provider agent integrations. One protocol, many agents.

## Why

Figma sits outside the context that coding agents work in. As more design work is done
by agents, the design must live next to the code, be readable and editable by both
people and agents, and be reviewed and versioned with the same tools as the code. The
editing experience should still feel like a design tool, not like an IDE.
