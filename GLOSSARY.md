# Glossary

The names this repository's modules are given, for the concepts they own. The decisions behind
them are in `docs/adr/`; [ADR 0037](docs/adr/0037-deep-modules.md) says why each concept has one
module, and [ADR 0038](docs/adr/0038-deep-modules-second-review.md) gives the ones it left
half-done theirs, and [ADR 0039](docs/adr/0039-deep-modules-third-review.md) the ones a third
review found.

## Design

- **Design system**: the tokens, typography, components and looks a canvas is drawn with,
  kept in `design-system.json` (everything but values) and `design.tokens.json` (every token's
  value) (ADRs 0028, 0035). Read and written by the server's `design-system-files` codec.
- **Token**: a named value of the design system (`color-primary`, `text-xl`, `radius-md`), of a
  **kind** its name's prefix says. The **token table** (contracts' `token-table`) says which list
  of the design system holds each kind; the **spacing base** is the token named `spacing`. The
  **spacing scale** is the base's multiples: a **step** (`spacing-4`, a class's `p-4`) is 4 × the
  base, which no list holds and only a named spacing (`spacing-gutter`) overrides; the **named
  steps** are the ones a designer is offered. A token's **short name** is its name without its
  kind's prefix (`card` for `color-card`).
- **Token value**: what a token holds, read as a colour, a length, a duration, a number or text
  (contracts' `token-value`), with one notion of the same value, a length in pixels, and the
  code's `var()` and `calc()` worked out.
- **Side**: somewhere else a design system's tokens live: the code, Figma, DESIGN.md (ADRs 0025,
  0027, 0028). Each is compared with the design against its **baseline**, what the two last
  agreed on; the **agreement** rule gives a token's outcome. The **sync engine** compares any
  side, with what each side is to it in `sync-readings`; a **side adapter** (`sync-sides`) says
  how one side is read, matched and kept. Each side owns what it knows: the **code side**
  (`CodeSide`) the code's tokens, read once for every caller, its stylesheets written all or
  nothing, its agreement and the preview's CSS; `DesignMd` the document, its **mirror** of the
  tokens, its baseline and its lint; `FigmaBaseline` Figma's baseline while there is no design
  system. The **target tokens** a side is matched to are the design's, else the code's own. The
  **sync plan** (`sync-plan`) is the steps that bring the design system and the code together.
- **Node style**: what a node's fields mean, as CSS declarations at the base and at each
  breakpoint, tokens kept by name (design-document's `declarationsOf`). The canvas draws them,
  over what it draws besides (`baseStyle`); a style system's **class writer** writes them as its
  classes, Tailwind's with its `md:` and `max-md:` variants (ADR 0024).
- **Page**: a design document, `.page.json`, of a **canvas** (ADRs 0015, 0019, 0020). A page is
  drawn in a **frame**, and in **views** of other widths beside it (ADR 0036); an edit lands at
  the **breakpoint** of the view it is made in. The breakpoint a frame is at is the one its width
  falls in, a node on the canvas's its own fixed width (the web's `frameBreakpoint`). A page's **family** is its base page with its
  variants and states, which are named after it and move and go with it (`familyOf`).
- **Canvas layout**: where frames go on a canvas, with one gap (contracts' `canvas-layout`): a
  new frame past every frame and its views, a copy, variant or state beside its page when nothing
  is there, a page the layout does not place yet where the editor draws it, a new view beside its
  page and the view's name.
- **Snapshot**: a named point in the designs' history (ADR 0019), a ref of the `designs`
  namespace in the tool's **snapshot store**.

## Agents

- **Thread**: a conversation with an agent about a scope; a **turn** is one prompt and what the
  agent does with it. A thread's **session** (`ThreadSession`) holds its live state and status;
  a thread is **busy** while a turn runs or is being stopped (`isBusy`). How a thread is shown
  (busy, waiting on the user, failed, and the word a list, a dot or a badge says) is the web's
  `threadView`; what a prompt carries for its chips, a comment sent to an agent's included, is
  `attachmentsOf`.
- **Card**: what the agent waits on the user for, a permission or a question
  (`PendingCards`, ADR 0022).
- **Agent launcher**: the seam an agent is started through: its sandboxed process (ADR 0013),
  or a scripted in-memory agent in tests.
- **Built-in agent**: an agent that ships with the tool (Claude Code, Codex), each one
  **descriptor** in acp's `built-in`: how the command launches it through `npx`, the ACP adapter
  the desktop app bundles in its place, its program, how it is asked whether it is signed in and
  what its answer says, a sign-in through its adapter, the variable a key goes in, and its
  variables by where the app found it (ADRs 0004, 0031). Their ids are contracts'
  `BuiltInAgentId`; any other agent is a JSON file of the user's.
- **Task**: what the editor asks an agent to do (implement a page, a setup step, a sync), named
  by a typed **task request**; a **slash command** is a request written as text.
- **Setup step**: one of the design system's five set-up steps (ADR 0023), run with its thread
  by `SetupSteps`.

## Preview

- **Preview**: the repository's own components running in the editor's page (ADR 0034).
- **Provenance**: whose code is calling, the page's or the editor's, by a rule named for what a
  guard guards.
- **Guard**: a patch that keeps the page's code to its frame (its listeners, timers, requests,
  storage, head and body).
- **Turn** (of the preview): the frame whose page code is running, held by `turn`; the
  **kernel** installs every guard in one order.
- **Page runtime**: the globals the server's generated code calls in the page
  (contracts' `page-runtime`).
- **Editor frame**: a frame as the editor opens it, with its host, the pool that parks it and
  the watchdog's freeze check (`editor-frame`).

## Editor and shell

- **Location**: where the editor is: canvas, page, route, variant, with the URL.
- **Server data**: what the editor holds of the server's, each **piece** declared by its store
  with `follow` (how it is read, what the store does with it, the events that bring news of it)
  and followed by one module, `server-data`: the events reach it, it is read again at every
  connection open once asked for, the project's first, and an answer for a canvas no longer open
  is dropped. A snapshot on screen is the other **source** of what it keeps (the pages, the
  documents, the layouts), whose news waits until the editor goes back to now (ADR 0019).
- **Selection**: the nodes of a page the user picked, which every view of the page shows, by one
  rule (the web's `selection`): a Shift-click in another view adds to it. It is in the view it was
  made in, whose breakpoint its fields are shown and edited at; a node of it Shift-clicked or
  right-clicked in another view takes it there. The inspector, the element toolbar, the outlines
  and Layers read the selected nodes as that view draws them, and what several share as one value
  or `MIXED`.
- **Layers' tree**: the Layers panel's rows as data (the web's `layer-tree`): what a filter leaves
  of them, their **folds** (the rows flipped from pages open and layers folded, or folded among
  what a filter finds), the way down to the selection a reveal opens, and where a dragged row
  lands, as a node-actions `Place`. The panel draws it and forwards its events.
- **Showing a panel**: one verb a side, which brings a panel put away back and leaves the
  prototype (ADR 0032): `showRightPanel(tab)`, and `showLeftPanel` a tab of the rail's with what
  it is asked to show there, a **request** (a thread and its draft, a file's changes, a node to
  rename in its Layers row) that waits until the panel takes it up (`useRequest`).
- **Command**: something the editor does, in one list the palette, the shortcut sheet and the
  menus read (ADR 0032); a **binding** is a command's chord and the scope it works in.
- **Menu action**: what a context-menu item does, a typed value run by `runMenuAction`.
- **Shell bridge**: the desktop shell's capabilities, one table the web's `Platform` is typed
  from (ADR 0031).

## Server

- **Composition root**: what the server is made of, each service on the ones below it, in
  `composition.ts`: the foundation, the open project's layer, the threads and the application
  layer. It is built with **adapters**, the seams that have a test's second one: the preview's
  host and the agents' launcher with its sandbox. `ProjectTest` builds the same application in
  a test, a project open on a fixture, and `callTool` calls an MCP tool's handler in-process.
- **Settings in force**: the settings the open project runs, which `ProjectManager` alone puts
  in force, whoever asks (a save, a session saved to a file, a file renamed or changed by someone
  else, detection at start): the project is opened, opened again when it runs other settings, or
  left as it is, by one rule. It tells the editor the project's info, the settings in force
  among it, whenever what the info is made of changes. The editor saves through
  `settings-actions`, which reads the project again.
