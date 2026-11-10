# Commands and settings

## In a chat

Type `/` in the composer for the list. A command is expanded into the agent's task; what you
type after it is added to it.

| Command | What it does |
|---|---|
| `/setup` | An agent checks the settings detected for this folder against the code and saves them, with the designs directory, to `ultrapaint.config.json` |
| `/init` | An agent imports the repository's design system: its tokens, text styles and conventions, written as the design system and `DESIGN.md` |
| `/implement <page>` | An agent writes a page (by URL or file), or a component (`/implement Button`), in your application, with your components and conventions |
| `/implement --adopt [canvas or pages]` | An agent links pages already built in your application to the files that implement them, changing no code |
| `/import-figma [import]` | An agent maps an imported Figma file's components to yours and writes its frames as pages |
| `/redraw <canvas> <what to change>` | Changes every page of a canvas, a copy made to go another way |
| `/design-system <step>` | Runs a step of the design system's setup in its chat: `define`, `map` or `migrate` (Sync opens these for you) |
| `/sync` | Opens the Sync view on the steps for your repository's case (no agent turn) |
| `/sync describe` | An agent describes in the design system what the code has that it does not list: new tokens, asking you what they are for |
| `/sync figma` | An agent matches the imported Figma file's tokens to the design system's, asking you where the meaning is yours to say; you review and write them in Sync |
| `/sync design` | An agent matches `DESIGN.md`'s tokens to the design system's and settles its text styles with you; you review and write them in Sync |
| `/sync code` | An agent brings the code up to the design: exports the tokens waiting for it, and asks you about what the code changed alone or on both sides |

The agent's own slash commands are listed after these.

## In the editor

| Where | What to do there |
|---|---|
| The place switch, at the top centre | **Canvas** (the pages), **Design system** (the foundations and components on boards) or **Prototype** (click through the canvas) |
| **Search**, in the project's card, or ⌘K | Every command of the editor, by name, and the pages, canvases and chats to go to |
| `?` | Every keyboard shortcut |
| The tools, at the bottom centre | **Insert** (+): a row, a column, a text or an image; the tools; **Undo** and **Redo**; the zoom |
| **Agents**, on the rail | Your chats, and a new one; **Set up** and the folder's name while its settings are not saved |
| **Components**, on the rail | Your components, as a list or a grid: click to insert, drag onto the canvas, ↗ for its board, + for a new app component |
| **Comments**, on the rail | The comments left on the canvas's pages |
| **Changes**, on the rail | The files changed, the snapshots and the agents' checkpoints to compare with or go back to, and a commit when **Write to git** is on |
| Design system → **Foundations** | The foundations and the guidelines; click a token, a group or a text style to edit it in the inspector |
| Foundations → ⟳ **Sync with the code** | Bring the design system and the code together, whatever you start from |
| Foundations → the wand, **Run /init with an agent** | `/init` in a new chat's composer |
| Foundations → **Make it from the code**, **Other ways** | While the project has no design system: make it from the code, **Pick a new look…** or **Import from Figma…** |
| Components → a component's board | Its look in every variant and state, or an app component's variants; the inspector edits it |
| A board's inspector → **Add to chat** | Send what is picked to the chat |
| The inspector → **Code** → **Implement** | `/implement` for that page |
| The composer → the **Review** chip | This design's review level ([Agents](agents.md#designs-are-reviewed)) |
| The ⚠ beside the project's name | Save the settings to `ultrapaint.config.json` |
| A dot on **Design system** and on **Foundations** | Sync has something waiting: settings to fix, drift to describe, Figma tokens to take |
| **Settings** › **Repository** | Where the repository, the designs and your code are; **Write a PNG of every page**; **Write to git**, off unless you want the Changes panel to commit |
| **Settings** › **Design system** | The design system and `DESIGN.md`, with an agent to set them up or update them; the stylesheets Sync reads and writes |
| **Settings** › **Preferences** | The editor's **Theme**, your **Display name** (for comments when git has none), the **Send key**, and **Keep findings** |
| **Settings** › **Agents** | In the desktop app, **On this computer**; **New chats** (the agent, model, effort and permissions a chat starts with), **Review**, **Design skills**, and **Connect over MCP** for an agent outside the editor |
| **Settings**'s footer → **Rename to ultrapaint.config.json** | Shown for a configuration still called `ultrapaint.json` |

**Preferences** apply at once, in every project.

## The configuration file

`ultrapaint.config.json` at the root of the repository (paths relative to it):

| Field | What it is |
|---|---|
| `designsDir` | Where the pages are (`docs/designs`) |
| `resolveFrom` | The package your application is (`front`), for its stylesheets' imports; a hint for agents that implement |
| `libraryDirs` | Optional: where your components are (`front/src/components`), a hint for agents that implement |
| `hostCss` | The stylesheets that set up your design system, whose tokens Sync reads and writes |
| `styleSystem` | What the tokens are written in: `tailwind-v4` (the default, and the only one today) |
| `codeTokens` | `auto` to write a token changed in the design to the code at once; `manual` (the default) leaves it waiting in Sync for an export |
| `pagePngs` | `true` to keep a PNG of every page beside its file (off by default) |
| `git` | `on` to let the tool commit and run `git init` (off by default); a repository is read either way |
| `review` | How designs are reviewed: `on`, `reviewModels` (each an `agentId`, a `model` and an optional `effort`, in the order they take turns), `eachRound` (`one`, `rotate` or `all`), `approval` (`all` or `one`) and a `goal`. Absent, Standard with the strongest model of each agent signed in |
| `skills.disabled` | Design skills agents are not told: `ultrapaint` for the design skill, a project file's name for its own |
| `skills.briefing` | How a design thread is told the design skill: `router` (the default) tells its core whole and has the agent read its references when the core sends it there; `full` tells the core and every reference whole; `summaries` tells each skill by its title and summary, read whole when needed |

You rarely write it by hand: **Settings**, the setup chat (`/setup`) and Sync's **Detect and
apply** write it for you.
