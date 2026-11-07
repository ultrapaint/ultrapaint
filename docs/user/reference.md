# Commands and settings

## In a chat

Type `/` in the composer for the list. A command is expanded into the agent's task; what you
type after it is added to it.

| Command | What it does |
|---|---|
| `/sync` | Opens the Sync view on the steps for your repository's case (no agent turn) |
| `/sync describe` | An agent describes in the design system what the code has that it does not list: new tokens, asking you what they are for |
| `/sync figma` | An agent matches the imported Figma file's tokens to the design system's, asking you where the meaning is yours to say; you review and write them in Sync |
| `/sync design` | An agent matches `DESIGN.md`'s tokens to the design system's and settles its text styles with you; you review and write them in Sync |
| `/sync code` | An agent brings the code up to the design: exports the tokens waiting for it, and asks you about what the code changed alone or on both sides |
| `/init` | An agent describes the theme you have as the design system, and writes `design-system.json` and `DESIGN.md` in the format's sections |
| `/import-figma [import]` | An agent maps an imported Figma file's components to yours and writes its frames as pages |
| `/implement <page>` | An agent writes a page (by URL or file), or a component (`/implement Button`), in your application, with your components and conventions |
| `/implement --adopt [canvas or pages]` | An agent links pages already built in your application to the files that implement them, changing no code |
| `/redraw <canvas> <what to change>` | Changes every page of a canvas, a copy made to go another way |
| `/design-system <step>` | Runs a step of the setup in its thread: `define`, `map` or `migrate` (Sync opens these for you) |

## In the editor

| Where | What to do there |
|---|---|
| Foundations → **Sync** (⟳), or its empty state | Bring the design system and the code together, whatever you start from |
| Foundations → Sync → **Import a Figma file…** | Take a `.fig` file's tokens, then its frames |
| Foundations → a foundation or a guideline | Its boards; click a token, a group or a text style to edit it in the inspector |
| Foundations → the wand | Run `/init` again |
| Components, on the canvas | Your components, as a list or thumbnails: click to insert, drag onto the canvas, ↗ for its board, **+ New** |
| Components → a component's board | Its look in every variant and state, or an app component's variants; the inspector edits it |
| Canvas / Design System, under the project | Switch between the pages and the design system; the rail shows each one's panels |
| Tools → **+** | Insert a row, a column, a text or an image |
| A board's inspector → the chat button | Send what is picked to the chat |
| Pages panel → **Implement** | `/implement` for that page |
| Settings → Repository | Where the components, stylesheets and designs are; **Write to git**, off unless you want the Changes panel to commit; **Rename to ultrapaint.config.json** for an old file |
| Settings → Editor → **Display name** | The name your comments are signed with when git has none |
| Settings → Design system | The design skills agents are told, and how |
| Title card → **Not saved** (⚠) | Save the configuration to `ultrapaint.config.json` |
| ⌘K, or **Commands** at the top right | Every command of the editor, by name |
| A dot on **Design System**, and on Foundations | Sync has something waiting: settings to fix, drift to describe, Figma tokens to take |

## The configuration file

`ultrapaint.config.json` at the root of the repository (paths relative to it):

| Field | What it is |
|---|---|
| `designsDir` | Where the pages are (`docs/designs`) |
| `resolveFrom` | The package your application is (`front`), for its stylesheets' imports; a hint for agents that implement |
| `libraryDirs` | Optional: where your components are (`front/src/components`), a hint for agents that implement |
| `hostCss` | The stylesheets that set up your design system, whose tokens Sync reads and writes |
| `styleSystem` | What the tokens are written in: `tailwind-v4` (the default, and the only one today) |
| `pagePngs` | `true` to keep a PNG of every page beside its file (off by default) |
| `git` | `on` to let the tool commit and run `git init` (off by default); a repository is read either way |
| `skills.disabled` | Design skills agents are not told: `ultrapaint` for the design skill, a project file's name for its own |
| `skills.briefing` | How a design thread is told the design skill: `router` (the default) tells its core whole and has the agent read its references when the core sends it there; `full` tells the core and every reference whole; `summaries` tells each skill by its title and summary, read whole when needed |

You rarely write it by hand: the setup and **Detect and apply** in Sync write it for you, and
agents never do.
