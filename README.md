# ultrapaint

ultrapaint is a local-first design tool for teams that work with coding agents. The canvas is
drawn with ultrapaint's system components — buttons, fields, selects, menus, popovers, dialogs, on
Base UI — in your design system's tokens and looks; the designs live in your repository as plain
JSON documents, and agents such as Claude Code and Codex work on them next to you over
[ACP](https://agentclientprotocol.com), then turn them into your application's own code, with
your own components.

Nothing is installed in your repository and nothing leaves your machine: the tool runs a local
server, draws the canvas itself, runs none of your code, and writes pages as `.page.json` files
you review and commit like any other file. A project with no code at all designs the same.

## Why teams move to ultrapaint

**You have a React app and no design system.** Most products do: a theme that names a few
colours, `bg-[#3b82f6]` and `p-[13px]` everywhere else, plain `<button>`s next to the library's
`Button`. Run ultrapaint in the repository and **Sync** reads what the code actually uses,
makes a design system out of it with an agent that asks you what each colour means, and can
then bring the code onto it a directory at a time, every batch undoable.

**Your designs live in Figma.** Import the `.fig` file. Its variables and styles become your
design system's tokens, light and dark (your Tailwind theme's, written where they belong, when
the project has no design system yet), and its frames become pages drawn with the system components,
not pictures of them. Import the file again after the designer changes it, and only
what changed comes across; where the design system changed too, you pick.

**Your design system and your code drift apart.** Someone changes a colour in the frontend
and nobody updates the design system, or the other way round. In ultrapaint the design leads
and the code follows: a token's value lives in the design system, the code is compared with it
against what the two last agreed on, and Sync exports what the code is missing, takes in what
the code changed, and lets you pick where both changed. A redesign can change the palette, and
restyle a component, without touching the application until you export or implement.

**You are starting from nothing.** Start an application from the editor: Vite, React and
Tailwind v4 with a set of components to design with, its theme taken from your Figma file when
you have one. Then design, and have an agent implement the pages in it.

**Your team works with coding agents.** Claude Code and Codex design on the canvas next to you,
with the system components and your tokens, ask you on cards when a decision is yours, and turn a
finished page into your application's own code with your conventions. The editor remembers
which code implements which page, and the next implementation is told only what changed.

Whichever of these you are in, it is the same action: open the **Design system** panel and press
**Sync**, or type `/sync` in a chat. It works out the case and lays out the steps.

## Installation

> [!WARNING]
> ultrapaint is not on npm yet. It is installed from a release of this repository, or run from
> a checkout of it. You need [Node.js](https://nodejs.org) 24 or newer.
>
> Agents are optional. To use one, install and sign in to it first; ultrapaint uses the login
> you already have:
>
> - Claude Code: install [Claude Code](https://claude.com/product/claude-code) and run `claude` once to sign in
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`

### From a release

Each [release](https://github.com/ultrapaint/ultrapaint/releases) carries the command as a
package, `ultrapaint-<version>.tgz`: the server and the editor already built, nothing to clone.
The repository is private, so download it with the [GitHub CLI](https://cli.github.com), or from
the release page while signed in.

To try it without installing anything, run this in the repository you want to design in. It
downloads the latest release to a temporary directory and runs it from there:

```bash
dir=$(mktemp -d)
gh release download --repo ultrapaint/ultrapaint --pattern '*.tgz' --dir "$dir"
pnpm dlx "$dir"/ultrapaint-*.tgz
```

`pnpm dlx` needs the tarball's absolute path: a relative one is read from pnpm's cache, not from
where you are. Flags go after the path (`pnpm dlx "$dir"/ultrapaint-*.tgz --port 4800`).

To keep the command, install it globally instead:

```bash
gh release download --repo ultrapaint/ultrapaint --pattern '*.tgz'
pnpm add -g ./ultrapaint-*.tgz
```

pnpm installs global commands into a directory of its own; if it says that directory is not on
your `PATH`, run `pnpm setup` once and open a new shell. `npm install -g ./ultrapaint-*.tgz`
works too. To update, download the newer release and install it the same way.

### From a checkout

The checkout is the way to run what is on `main` before it is released, and to work on
ultrapaint itself. You need [pnpm](https://pnpm.io/installation) and git as well.

```bash
git clone https://github.com/ultrapaint/ultrapaint.git
cd ultrapaint
pnpm install
pnpm install:cli
```

`pnpm install:cli` links the `ultrapaint` command into `~/.local/bin`; make sure that directory
is on your `PATH`. On Windows, or to skip the link, run `pnpm start` from the checkout instead.
The first start builds the editor, which takes a few seconds. To update, pull and install again:
`git pull && pnpm install`.

`pnpm pack:local` makes the package a release carries, from the checkout as it is, in
`dist/ultrapaint-<version>.tgz`. A release is made by hand: the **Release** workflow in the
Actions tab raises the version in `package.json`, tags it and attaches the package.

### Starting it

Go to the repository you want to design in and start it:

```bash
cd ~/code/your-repo
ultrapaint
```

It serves the editor and its backend on `http://127.0.0.1:4770` and opens it in your browser.
Started again in a project whose server already runs, it opens that one's editor instead of
starting a second: the server leaves `run.json` in its state directory while it runs. The folder
need not be a git repository, and the tool needs no git. `ultrapaint --help` has the full
reference; the flags you are most likely to want:

| Flag | What it does |
|---|---|
| `--config <file>` | Use this configuration file instead of looking for `ultrapaint.config.json` |
| `--ephemeral` | Save nothing, even when a configuration file exists |
| `--port <number>` | Listen on another port; `0` picks a free one |
| `--host <address>` | Listen on this address instead of loopback, to reach the editor from another machine (see below) |
| `--allowed-host <name>` | Also answer requests that name the editor so: a reverse proxy's name, or a VPN's; `.example.com` allows its subdomains. Repeat it for each name |
| `--no-open` | Do not open the browser |
| `--ready-json` | Once listening, print `{"pid","port","token","url"}` as one line of JSON on stdout (logs go to stderr), for a program that starts the server |
| `--dev` | From a checkout only: run its sources with hot reload instead of its build. The server restarts and the editor reloads as the checkout changes. Listens on loopback too; `--host` opens it to the network |

### As a devDependency of your project

A project can depend on the checkout instead, so the command is pinned to it and everyone on
the project runs the same one. Nothing is published: the dependency is a link to the checkout
on disk, and it follows every change made there.

```bash
cd ~/code/your-repo
pnpm add -D ultrapaint@link:../ultrapaint
```

That puts `ultrapaint` in `node_modules/.bin`, so `pnpm ultrapaint` starts it, or a script
does:

```json
{ "scripts": { "design": "ultrapaint" } }
```

The checkout has to be installed (`pnpm install` in it) for the link to work, and the link is
a path on disk, so everyone on the project needs the checkout at that relative path. When there
are packaged releases the link becomes a version.

The link follows the checkout: the server runs from its sources on every start, and only the
editor is a build, made once. While changing ultrapaint itself, start it with `--dev` instead
and nothing is built: the server restarts and the editor reloads as the checkout changes.

```bash
pnpm ultrapaint --dev
```

### The desktop app

The same editor in a window of its own, with a list of projects and a switcher in the header
([ADR 0031](docs/adr/0031-the-desktop-app.md)). It starts each project's server itself and
brings the agents' adapters inside it: it needs Node.js (22.12 or newer) only for the preview,
and finds it, with `claude` and `codex`, on the PATH your login shell has. An agent it cannot
find is offered under Settings, Agents, as a download into the app's own data; Codex signs in
with ChatGPT from there, Claude Code by running `claude` once in a terminal or with an API key
the app keeps in the system's keychain. A project whose server the command already runs is
opened in it, and left running.

**New design**, on the welcome page and in the switcher, starts a design in a folder with no
code yet: a name, a folder (`~/Ultrapaint/<name>` unless you pick another), a template (**Blank**:
no components and a theme that declares nothing; **Starter components**: one for each system component,
by the same name, props, parts and variants, on Base UI, so a design is implemented onto them one
to one), the
code in `app/` or at the folder's root, and whether to keep it in git (off by default; on, it is
`git init` and a first commit, `Start <name>`). The app writes it step by step, installs it with
pnpm when it is on your PATH and npm otherwise, adds it to the list and opens it on Sync's
**Define** step. A step that fails says why and leaves what was written: open it as it is, or
try again, which finishes it.

The command does the same without the app:

```bash
ultrapaint new ~/Ultrapaint/Acme --template starter --code app --git
cd ~/Ultrapaint/Acme && ultrapaint
```

**Open over SSH…**, on the welcome page and in the switcher, opens a folder on another machine:
a host (an alias of your `~/.ssh/config`, offered as you type, or `user@host:port`), the folder
there, and the command that runs the editor there when it is not `ultrapaint` on that machine's
PATH (`node ~/ultrapaint/scripts/cli.ts` for a checkout, say). The app runs your own `ssh`, with
your configuration, keys and agent, starts the server in that folder from your login shell there,
and forwards its port and the preview's to this machine; agents and the preview run on the other
machine, with its Node.js and its agents. That machine needs Node.js and the `ultrapaint`
command, installed as above. The app cannot type a password or a key's passphrase: load the key
into your agent (`ssh-add`) or set one up (`ssh-copy-id <host>`), and connect once in a terminal
to accept the host's key. A dropped connection is made again by itself, the canvas saying so
meanwhile; quitting or switching stops what the app started there.

Releases do not carry it yet: build it from a checkout, for the machine you are on (an AppImage
and a deb on Linux, a dmg and a zip on macOS, unsigned), or run it from the checkout.

```bash
pnpm desktop:build                              # installers in apps/desktop/release
pnpm desktop:dev                                # the app from the checkout, the server from its sources
pnpm desktop:dev -- ~/code/your-repo            # opening a folder, which joins the list
```

## First run

Start `ultrapaint` inside a repository and the setup looks at it for you: it asks only where
the designs go (`docs/designs` unless you already have one) and which stylesheet sets up your
design system, and proposes both. Where your application and its components are is filled in
quietly, as hints for the agents that implement (Settings → Repository → Implementation).
Confirm or change the proposals, and the canvas opens with **Sync**, which takes you on from
there. A repository with no React
application gets **Start a new application here** instead.

Only Tailwind v4 is read today: the tokens are its `@theme`. The setup says so when the
stylesheets set up Tailwind v3 or no Tailwind at all. Styling is a separate adapter from the
framework, so StyleX or Emotion would be another one, not a rewrite
([ADR 0024](docs/adr/0024-style-systems.md)).

Nothing is installed for the designs, and none of your code runs: the canvas draws the editor's
own system components in your design system's tokens.

Started like this, without a configuration file, the top bar says **Not saved**: your settings
and agent threads go away when the tool stops. Click it to save an `ultrapaint.config.json` in
the repository. The file holds no path of your machine and is meant to be committed, so the next
person only runs `ultrapaint`. A configuration file that appears while the tool runs (a
teammate's pull, one you wrote) is taken at once, without a restart. A file still called
`ultrapaint.json`, its earlier name, is read too, and **Settings** renames it.

| Started with | Settings | Agent threads, checkpoints, caches |
|---|---|---|
| an `ultrapaint.config.json` (or `ultrapaint.json`) found from the working directory up, or `--config <file>` | that file | `.ultrapaint/` next to it, git-ignored |
| neither | not saved until you save a configuration | a temporary directory |
| `--home <dir>` (what `pnpm dev` uses) | `<dir>/settings.json` | `<dir>` |

Your pages are files in your repository and are written there in every case.

## From another machine

`ultrapaint --host <address>` listens on that address instead of loopback: this machine's
address on a private network such as Tailscale, or `0.0.0.0` for every interface. The command
prints the addresses the editor is reachable at, and the preview is served on the same address.
`--dev` stays on loopback as well; with `--host` the editor's dev server listens on that address
too.

The server answers only requests that name it by one of its own names, so that a website you
have open cannot reach it by pointing its own name at your machine. Those are the address it
listens on, or with `0.0.0.0` any address the machine has at the time (a network joined later
included), its host name and `<host name>.local`. A name it has elsewhere (a MagicDNS name, a
fully qualified one, a reverse proxy's) is given with `--allowed-host`, once per name. With
`--dev` the editor's dev server keeps Vite's own check, which knows nothing of these names.

There is no login. Whoever reaches that port can run agents in the repository with your rights,
so keep it to a private network and prefer the network's own address over `0.0.0.0`.

## Agents stay in the repository

An agent you start here runs inside a sandbox: it reads the repository, its own files and the
toolchain, and writes nothing but the repository, its own files, the package caches and the
temporary directories. Your home directory is closed to it. That holds for the shell commands it
runs too, and it does not depend on the agent — it is the operating system's doing. Network is
open, because an agent has to reach its model.

This works on macOS, and on Linux when [bubblewrap](https://github.com/containers/bubblewrap) is
installed (`bwrap`). Elsewhere the thread says **Not scoped**: the agent runs with your own rights
until the sandbox for that platform lands.

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
select several, and set what they share at once. What you send while an agent works waits in the
thread and goes when its turn ends. Right-click an element to copy
a link that opens the editor on it, or its ID (`/orders#c_8x2k1q`), which an agent takes to find
it.

It saves the agent from reading the repository to find out what the editor already knows. On four
tasks with the model pinned, two runs each, that was 32 tool calls on average without any of it,
24 with the briefing and 15 with the tools as well — and roughly half the time per task. On two
of the four the three arms do not overlap at all; on the hardest one they still do
([the measurements](docs/feature/benchmarks/), which say what they cannot yet tell apart).

An agent outside the editor can use the same tools: **Settings** shows the line that adds it.

## Design documents

A design is not code. It is a small tree of nodes, the way a design tool sees it:

| Node | What it is |
|---|---|
| `page` | A screen at a route; it lays its children out in a column |
| `row`, `column` | A flex container, horizontal or vertical: gap, alignment, padding, wrap |
| `group` | A plain container that only holds and styles its children |
| `text` | A heading (level 1–6) or a paragraph |
| `image` | A picture from the space's `assets/` directory |
| `instance` | A component, a system one of ultrapaint's or an app one of yours, with its props; its children fill its slots |

Sizes are `fill`, `hug` or pixels, and every colour, radius, shadow, spacing and type setting can
be a token of your design system (`"$color-primary"`, `"$text-lg"`, `"$spacing-4"`), so the
design follows the theme when it changes. `get_document_format`, on the editor's MCP server,
gives an agent the whole format as a JSON Schema.

A page file is JSON written one node per line: a node's own fields on its line, its children
indented below it. A change in the inspector is a change to one line, and a reviewer reads the
tree from the indentation. With `pagePngs` on (Settings → Repository → **PNG of every page**),
every page also gets a PNG beside its file, `orders.page.png`, drawn by the editor's preview at
the size of the page's frame. It is drawn again only when the page, its frame or the design system
changes, so anyone browsing the repository sees the screens and a pull request shows them as
image diffs. A page changed while no editor is open keeps its old picture until one opens.

The **Layers** panel shows the whole space at once, as a design tool does: every page with its
tree, and the nodes placed on the canvas beside them. A node inside a page follows the page's
layout; a node on the canvas has its own position. Drag one from one to the other, in the layers
or on the canvas. The tree is walked with the arrow keys, a layer is renamed with a double-click or
F2, hidden with its eye and locked with its lock, so a click on the canvas passes it by; the field
at the top finds layers by name, text or component.

Several elements selected at once are changed together everywhere, in the inspector (where the
fields they differ on say "Mixed"), the menus, the toolbar and the keys, as one undo step. ⌘\
(Ctrl+\) puts the panels away, and `?` lists every shortcut, written as your platform writes
them. ⌘K (Ctrl+K) finds any command by its name: a panel, a tool, a zoom, what the selection's
right-click menu offers, a page, a canvas or a chat.

The editor is cards floating over the canvas: the project at the top left, the rail of panels
under it (Agents, Layers, Design system, Library and Changes) beside the left panel, the tools in
a column next to it (the first, **+**, inserts a row, a column, a text or an image), and at the
top right the commands, the prototype (▷) and the right panel, with the inspector, the code and
the comments. Each side panel is put away on its own: with
the right one away the canvas is the agent's, with the chat beside it. ⌃1 is the canvas and ⌃2
the prototype on a Mac, Alt+1 and Alt+2 elsewhere. In the desktop app on a Mac the window's
buttons sit in the project's card, and dragging the cards at the top moves the window.

When a page is ready, **Implement** in the Pages panel (or `/implement <url or file>` in a thread) asks
an agent to write it in your application with your own components and conventions: the tokens
become the matching Tailwind v4 classes, each system component your application's own component for it
(written in its library's way where it has none). The inspector's
**Code** tab shows the same translation for the selected element, written by the server through
the project's style system.

### Designs and the code that implements them

The design is what the UI looks like and which states it has; the code is what it does
([ADR 0030](docs/adr/0030-the-implementation-link.md)). The editor never runs your application,
but it keeps the link between the two:

- **Status.** A page is a draft, ready (Mark ready, in its menu or the inspector), implemented,
  or changed since: the design, the code or both. The Pages panel shows it as a dot, the
  inspector's Code row says which files implement the page and lists what changed in the design.
  `implementation.json` and the designs as they were implemented (`_implemented/`) live in the
  designs directory and are committed. A page renamed, or moved to another canvas, keeps its
  link; a copy is a new design and starts as a draft.
- **Tokens waiting for the code.** A token changed in the design and not exported yet is not in
  the application: a page that uses one says so ("Implemented · tokens wait for the code"), the
  inspector names them with an **Export** button, and `/implement` brings them over before
  writing the page. An agent cannot mark a page implemented while one of its tokens waits.
- **Implement what changed.** An implement thread is told the changes since the page was
  implemented, its behaviour notes, its states and the tokens it waits on, then the whole
  design, and marks the page implemented with the files it wrote.
- **Behaviour notes.** A comment can be a behaviour note: what the code must do that a design
  cannot show ("only admins can delete", "disabled until the form is valid"). It is pinned to its
  element and goes to the code with the page. A component has its own, in its file (the
  **Notes** of its board's inspector, in the Library), and they go to the code when it is
  implemented.
- **Bringing a project in.** Pages built before the project came into the editor start as
  drafts. Pick several in the Pages panel (⌘ or Shift) to **Mark them ready** at once, or **Find
  their code with an agent** (`/implement --adopt`, also in a canvas's menu): an agent finds the
  files that already draw each page and links them, changing no code.
- **States.** **Draw a state** (in a page's menu) draws the page again empty, loading, with an
  error or a dialog open (`orders@empty.page.json`); a link can open it, and implementing the
  page implements it as that state of the same screen.
- **Design and implement threads.** A chat designs: its agent can write the designs directory
  only, and a request about behaviour becomes a behaviour note. A chat started with
  `/implement` (the Implement button) implements, and may write the whole repository.
- **Agents outside the editor.** Connected through `claude mcp add` (Settings → Agents), an agent
  is told how to use `handoff`: what is ready or changed, the task for one, marking it
  implemented, writing a behaviour note on a page or a component, and exporting the design's
  token values to the code (or importing the code's).

### Components: the editor's and your own

Everything you place is a component ([ADR 0041](docs/adr/0041-system-and-app-components.md)), of
two origins, each kept as a file of the designs directory, `components/<Name>.component.json`:

- **System components** are ultrapaint's own, on Base UI
  ([ADR 0040](docs/adr/0040-the-editors-own-primitives.md)): Button, Badge, Spinner, Avatar, Card,
  Separator, Input, Textarea, Checkbox, Switch, Tabs, Select, Menu, Popover, Tooltip, Dialog and
  Toast. Their behaviour is fixed; their look is your design system's.
- **App components** are yours, built from system components and other app components: a
  pricing card, a site header.

Layout, text and image nodes are **elements**, inserted from the **+** at the head of the tools.
The **Library**, on the rail, lists the App components, then the System components, as a list or
as thumbnails: a click inserts one into the selection, a drag places it anywhere, **↗** opens its
board, and **+ New** makes an empty app component and opens its board. Colours, type and spacing
are in **Design system**.

**Boards.** Opening Design system, or a component in the Library, shows that item alone on a
canvas of its own, blue-tinted and dotted so that it is never taken for the pages: its **boards**,
drawn by the renderer that draws the pages from the design system and the component files, so
they cannot drift from them. The camera is the canvas's (wheel, pan, zoom), an item first seen
fits between the panels, the URL says where you are (`?view=library&item=Button`) so a reload or a
link lands on it, and **Back to** the page, or the browser's back, returns to the page as it was.
On a board the left panel is the list to go from item to item (the Library's **Overview** shows
every component), and the right panel is the inspector of what is open and picked there. Its
title has the chat button the element toolbar has on a page: what is picked (a token, a text
style, a guideline, a component at a variant and a state) goes to the chat, and an agent is told
what it is, what it is now and the file it is kept in.

Select a component and the inspector lists its props and its **slots** — a Dialog's trigger,
header, content and footer — with what fills each and a **+** that adds a text, a row, a column
or a button to it; Layers shows the slot each child fills. A row in a dialog's footer, aligned
right, with two buttons, is a standard footer.

Each frame is a page of its own: a select opens inside it, a dialog's backdrop covers it alone,
and a dialog is a sheet at the bottom of a narrow frame. While you design, an overlay is drawn
open where its `open` prop says, and nothing in the frame takes the pointer; in the prototype and
with the interact tool the system components behave (a menu opens, items take the hover, Escape
and a click outside close it), each in its own frame.

**A system component's look is yours.** Its board in the Library draws it in every variant and
every state at full size (hover, focus, disabled, open, checked, highlighted…), the members and
the states named, and a board for each further axis (Button's sizes); the interact tool makes
hover and press live there. It is in its **default look** (over your tokens) until you **take the
look over** (in the inspector, or its "…"), which starts its file from the default's values. Click
a cell to pick its place, or pick a Variant and a State in the inspector: both together set that
state in that variant alone (an outline button's hover), over the state's own values, and a field
left empty says what it takes and from where (the state, the variant, the base or the default
look). A value is drawn on every board and page as it is typed or gone through in a field's list,
and a field committed is one step you can undo. The
fields set: its fill, text, border, radius, padding (per side), size, gap, shadow,
and how it lays out what it holds (direction, alignment, order); a value can be any CSS over your
tokens' variables, a hover's `color-mix()`. It can leave out an optional
part (a dialog's close, a card's description), give a slot content for when an instance gives it
none, and draw a Select's or a Menu's items from nodes of yours (**Use selection**). **Reset to
default look**, in its "…", removes the file. **Implement** has an agent give your application's own component that
look, in whatever library it is written with. A component that adds behaviour, or takes away a
trigger, a popup or an item, is an app component built on the system one.

**App components.** Select part of a page and choose **Make an app component…** in its menu: it
becomes a component, and an instance of it takes its place. Double-click an instance (or **Edit
component**) to edit it in place: the rest of the page dims, what you select and change is the
component's, and every instance follows. There the inspector adds **properties** — a text, yes or
no, a choice, an image — or **exposes** a field of the node selected as one (its text, whether it
shows, its picture, a prop of a component inside it), and makes a container a **slot** that an
instance's children fill. A choice's members are **variants**: pick one in the banner under the
canvas and your edits land on it alone, and an edit made in a view of another width lands at its
breakpoint, which every instance shows at that width. Layers lists the component's tree while
you edit it. Escape, or **Done**, goes back to the page. An instance's
properties are its props in the inspector; **Detach** turns it back into plain nodes. Renaming a
property or one of a choice's members, or taking one out, follows into its variants and every
instance's props, in one step you can undo; two properties, slots or members cannot share a name.
**Implement** writes an app component as a component of your application, a prop for each
property and children for its slots. Its board in the Library draws each of its variants side by
side: a click picks one, a double-click edits the tree in place there (Layers lists it, the edits
landing on that variant), and the inspector lists its properties, variants (with how many fields
each overrides), slots, where it is used and its notes.

A page made before, with your application's own components, draws each of them as a stand-in.
**Sync** offers to bring the designs up to date in one step you can undo: a component is matched
by its name (shadcn's `DropdownMenu` is the Menu), its variants, children and text are kept, and a
compound component's parts (`DialogFooter`, `CardHeader`) fill the system component's slots; specs
and draft components from before become component files. A stand-in's menu has **Replace with a
system component** for one at a time.

## The design system

The design system is two files, both meant to be committed:

- `DESIGN.md`, at the root of the repository, in the open
  [DESIGN.md format](https://github.com/google-labs-code/design.md) that coding agents and design
  tools read and write ([ADR 0027](docs/adr/0027-design-md.md)):
  - its front matter holds the tokens (`colors`, `typography`, `rounded`, `spacing`), kept in
    step with the design system, and the `components` whose look you took over, from their files;
  - its body says, in the format's sections, what the product is, which colours mean what,
    which component to use for what, and what to always or never do.

  Every agent is told it, and an agent outside the editor finds it too. The format's own linter
  checks it: broken references, contrast, section order. A `DESIGN.md` in the designs directory
  is still read, and Sync moves it to the root.
- `design-system.json`, next to the designs: what the format has no place for. That is colours
  by palette and the semantic ones with what each is for, how each text style is built from the
  tokens, fonts, shadows, border widths, elevation levels (a surface, its shadow and its
  z-index), breakpoints and container widths, motion, the icon set and themes. It also keeps
  what Sync last agreed on with Figma, `DESIGN.md`, the code and `design.tokens.json`. A
  component's description and category are in its own file (`components/`), and the example a
  new instance starts with is the catalogue's.

**A token's value lives in the design system** ([ADR 0028](docs/adr/0028-the-design-holds-the-values.md)):
`design-system.json` holds every value in every theme, and `design.tokens.json` beside it says
the same in the [Design Tokens format](https://www.designtokens.org/tr/2025.10/) for Style
Dictionary, Tokens Studio and Figma's variables. When one of those tools changes
`design.tokens.json`, the editor does not write over it: Sync offers what it changed (**Take
design.tokens.json's changes into the design system**), then writes the file again. **Design system**,
on the rail, lists the **Foundations** it has tokens for (Color, Typography, Spacing, Radius,
Elevation, Motion, Breakpoints) and the **Guidelines**, `DESIGN.md`'s sections, with a search over
the tokens, and opens each as boards: every palette as its ramp, 50 to 950, the light and the dark
theme side by side, with the usual pairs of foreground and background and their contrast; the
type scale and the text styles; the other tokens as specimens, the easings animated. Click a token
and the inspector edits its value in each theme, its description and its group, says where it is
used and deletes it; a palette offers **Generate ramp from…** one colour, and a text style its
font, size, weight, leading and tracking. Each change is one undo step, and the canvas draws it
as you type, over your stylesheet's value. The code follows when you export it from Sync (**Bring
the code up to the design**, or `/sync code` for an agent to settle it with you), which writes
your stylesheet in the theme block the token is declared in. Turn on **Write token changes to the
code at once** there to have every edit reach the stylesheet as it is made.

`DESIGN.md`'s front matter mirrors those values in the default theme; its body says how dark mode
differs. When the design system changes a value, the front matter follows. When someone changes a
value in `DESIGN.md`, by hand, from Stitch or in a pull, it waits in Sync, matched and compared
with the design system's as a Figma file's tokens are, until you take it in. A guideline's board
shows its section as a document, edited in the inspector beside it and drawn as you type; what
the linter says is listed under the guidelines.

### Sync

**Sync** (the panel's ⟳ button, its empty state, or `/sync` in a chat) reads what the
repository has and lays out the steps for its case. The Design system button on the left rail
has a dot while something is waiting.

| You have | Sync does |
|---|---|
| nothing yet | starts an application (Vite, React, Tailwind v4, a component for each system component), then defines its design system |
| a Figma file, no application | starts an application with Figma's tokens as its theme, then turns the frames into pages |
| an application, no design system | reads what the code uses, has an agent define the design system, and offers to map and migrate the code onto it |
| a Figma file and an application | matches Figma's tokens to your code's and takes their values first, then the same steps, then the frames |
| a design system | moves `DESIGN.md` to the repository root, or writes a first one; takes what someone changed in `DESIGN.md` or another tool in `design.tokens.json` into the design system; exports what the code is missing and takes in what the code changed alone; lists what drifted (tokens the code has that the design system does not describe, and the other way round) and the `DESIGN.md` sections left to write, for `/sync describe`; compares a newer Figma import |

Settings that point nowhere (no stylesheet) come first in every case: **Detect and apply** proposes where they are and
applies them once you have seen it.

**Figma's tokens are matched first**, to the design system's (to your code's while there is
none), because a Figma file's names
(`Collection 1/Brand/600`) and palette are rarely what the frontend wants. Each variable and
style is one of your tokens, a new token under a name you choose, or left out of the code;
nothing that is not matched is written. Rules match what is certain (the same name, or the one
token with the same value, the semantic colour over its palette entry); **Match with an agent**
(`/sync figma`) has an agent match the rest, asking you where the meaning is yours to say; and
**Review the matches** lists every one to change. The matches are kept with the last sync, so a
newer import of the file goes through them.

Matched tokens are compared with the design system's, one by one and theme by theme: a colour
however it is written (`#3b82f6`, `rgb(…)`, `oklch(…)`), a length in px or rem. Each is also
compared with what the last sync agreed on, which is kept in `design-system.json`:

| Since the last sync | What happens |
|---|---|
| Figma changed it, or it is matched to a token the design system does not have yet | the design system takes Figma's value, in the unit it already uses |
| the design system changed it | it is kept; Figma is behind |
| both changed it, or there was no earlier sync and they differ | you pick, one by one or **All from Figma** / **All from the design system** |

`/init` is still there as the quick way to have an agent describe a theme that is already the
design system.

### Setting one up step by step

When the code has no design system, Sync takes it through five steps, in order; each one stops
for you before the next.

| Step | What happens |
|---|---|
| Inventory | The code is read for the colours, spacing, type sizes and weights, radii, shadows and z-index layers it uses, and the plain `<button>`s and `<input>`s where your library has a component. Each value is the design system's, one of Tailwind's own, or written out (`bg-[#3b82f6]`, `p-[13px]`, an inline style), with how often and where |
| Define | An agent writes the design system. It **adopts** the theme there is, as `/init` does, or **proposes** one from what the code uses: a palette and its semantic colours, a spacing base, a type scale, the radii and shadows, put to you on question cards and then written into the stylesheet's `@theme`. The inventory recommends one of the two; you choose |
| Map | The code is read again against the design system, and each value off it is given what it becomes: a token (`color-primary`, `spacing-3`), the library's component for a plain element, or kept as it is. Rules settle the exact matches; an agent the rest, asking you where the meaning is yours. You can change any of it in the panel |
| Migrate | The code is brought onto the design system a directory at a time. The rules rewrite what is mechanical, classes (`hover:bg-[#3b82f6]/50` → `hover:bg-primary/50`), inline styles and stylesheet declarations; the agent does the rest, a colour in a constant, a `<button>` to `Button`, then runs your type check and linter. Each batch can be reverted on its own |
| Verify | The code is read once more: how many uses are still off the system, against how many there were when the mapping was made, and how many of those are kept on purpose |

A step an agent does runs in a thread of its own, opened with `/design-system <step>` in its
composer and marked with the step it runs. **Stop** ends the agent's turn and keeps what it
did; **Resume** picks it up again. **Redo** puts back every file the step and the later ones
changed, as it was when the step started, after showing you the list, and takes the later steps
back to the start; files you changed yourself in between are left alone. Each step is kept as a
snapshot of the files your `.gitignore` keeps, in the tool's own snapshot store in the state
directory, and so is each batch of Migrate: no git is needed, and your index, branch and stash are
never touched. Where the setup is lives in the state
directory, not in the repository ([ADR 0023](docs/adr/0023-design-system-setup.md)).

### Design skills

Before it designs, every agent is also told how to design well, whatever the product: hierarchy,
layout, spacing, typography, colour, elevation, borders and radius, iconography, motion,
content, states, how to compose with components, and accessibility. These
skills ship with the tool and come before `DESIGN.md`, which wins where they disagree: a rule
that holds for this product alone belongs in its Do's and Don'ts. **Settings**
lists them, with a switch to turn any off (saved in `ultrapaint.config.json` as `skills.disabled`).

A project takes a skill over with a markdown file in `skills/` inside the designs directory:

- a file with a built-in's name (`skills/spacing.md`) replaces it;
- the same file opening with the front matter `extends: true` is told after the built-in instead;
- a file with any other name is a skill of its own.

**Replace…** and **Extend…** in Settings start that file for you, as one undo step. The file's
first heading is its title and the paragraph after it the summary Settings show.

**Design system**'s boards show them: swatches per theme, type specimens in your own fonts,
spacing, radius, shadows, elevation, border widths, layout and motion tokens. The **Library**
lists the components, or shows them as a grid of thumbnails drawn with the example props.

## Importing a Figma file

**Import a Figma file…** (in Design system's Sync view, the canvas list or a
canvas's right-click menu) takes a `.fig` file (File → Save local copy in Figma) and opens Sync on
it. Its tokens come first: variables mode by mode (Light and Dark become your themes), aliases
followed, and colour and shadow styles, named the way your code names tokens
(`Colors/Primary/500` is `color-primary-500`), compared with your code as above.

Then **Map and write the pages** opens a thread with `/import-figma` in its composer. The agent
decides, component by component, what each Figma component becomes: one of the system components,
with its variants and text properties mapped to props; a custom one, kept as the layers it is
made of; or left out. Where the names do not settle it, the agent asks you in the thread, with
the likely candidates to pick from, and carries on with your answers. Each frame is then written
as a page at a route that fits its name, with its pictures in the space's `assets/`, colours
that are tokens written as tokens, and the agent looks at it and mends what the rules could not
carry over.

Auto-layout becomes rows and columns, text keeps its font, image fills become images, icons
become SVG files. Free-positioned layers are stacked in reading order, and the import says so.
Exporting back to Figma is not done yet.

## Pages, URLs and canvases

A **page** is a `.page.json` file in a canvas, named after its file: "Billing settings" is
`billing-settings.page.json`. Renaming a page moves the file and keeps everything that points to
it. Nodes placed on the canvas outside any page are kept in the canvas's `canvas.json`.

A page may serve a **URL** in the prototype (`/settings/billing`, `/invoices/:id`), which
`canvas.json` keeps. A screen of the application has one; a sketch or a sheet of components needs
none. A page without a URL is drawn and edited like any other, but no link reaches it, and the
prototype warns when it shows one. A canvas made before URLs were optional serves each page at
the route its path names until its pages next change.

The **Pages** panel belongs to the **prototype**: every page of the canvas with its URL,
or a warning when it has none, where URLs are given, changed and taken off. Any node in a page can
link to another page (it keeps leading there when the page is renamed or its URL changes), to a
URL with its parameters, back, or to another site: in the inspector, its right-click menu or the
element toolbar. The prototype's bar shows what can be pressed, and a press on nothing flashes it. It also tries the
prototype on a phone, a tablet or a desktop without changing the design, and takes comments on the
page you are on. In the prototype the whole thing is one iframe: pressing a link swaps the page inside it,
provider and component state survives, and the route is in the editor's own URL — so the
browser's back and forward buttons are the prototype's, and a prototype state can be reloaded or
pasted to someone else.

A **canvas** owns one router and its own pages; a page of one canvas cannot navigate to a page of
another. The canvas's name at the top of the left panel opens the list of canvases.

## Commands and where things are

### In a chat

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

### In the editor

| Where | What to do there |
|---|---|
| Design system → **Sync** (⟳), or its empty state | Bring the design system and the code together, whatever you start from |
| Design system → Sync → **Import a Figma file…** | Take a `.fig` file's tokens, then its frames |
| Design system → a foundation or a guideline | Its boards; click a token, a group or a text style to edit it in the inspector |
| Design system → the wand | Run `/init` again |
| Library, on a page | Your components, as a list or thumbnails: click to insert, drag onto the canvas, ↗ for its board, **+ New** |
| Library → a component's board | Its look in every variant and state, or an app component's variants; the inspector edits it |
| Tools → **+** | Insert a row, a column, a text or an image |
| A board's inspector → the chat button | Send what is picked to the chat |
| Pages panel → **Implement** | `/implement` for that page |
| Settings → Repository | Where the components, stylesheets and designs are; **Write to git**, off unless you want the Changes panel to commit; **Rename to ultrapaint.config.json** for an old file |
| Settings → Editor → **Display name** | The name your comments are signed with when git has none |
| Settings → Design system | The design skills agents are told, and the ones you replace or extend |
| Title card → **Not saved** (⚠) | Save the configuration to `ultrapaint.config.json` |
| ⌘K, or **Commands** at the top right | Every command of the editor, by name |
| Rail → Design system dot | Sync has something waiting: settings to fix, drift to describe, Figma tokens to take |

### The configuration file

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
| `skills.disabled` | Design skills agents are not told |

You rarely write it by hand: the setup and **Detect and apply** in Sync write it for you, and
agents never do.

## Some notes

This project is very early. Expect bugs and breaking changes.

It supports React with Vite and Tailwind v4 today: the framework says where a repository's
application is and writes a new one, and styling is an adapter of its own beside it, so StyleX or
Emotion would be one too; neither exists yet. The canvas draws the editor's own components, so it
needs neither. Yarn Plug'n'Play is not supported.

## Documentation

- [What the project is for](docs/PROJECT-GOAL.md)
- [Where settings and state are kept](docs/adr/0010-storage-modes.md)
- [A command run in the repository](docs/adr/0017-a-command-in-the-repository.md), and [the desktop app around it](docs/adr/0031-the-desktop-app.md)
- [How the preview is built: editor, preview core, renderer, framework](docs/adr/0011-preview-split.md)
- [Spaces, pages and the router](docs/adr/0012-spaces-pages-router.md), and [pages with optional URLs](docs/adr/0020-pages-have-optional-urls.md)
- [Design documents instead of TSX pages](docs/adr/0015-design-documents.md)
- [Importing a Figma file](docs/adr/0016-figma-import.md)
- [Setting up a design system in steps](docs/adr/0023-design-system-setup.md)
- [Style systems: tokens read and written behind one interface](docs/adr/0024-style-systems.md)
- [One Sync for the design system and the code](docs/adr/0025-design-system-sync.md)
- [All architecture decisions](docs/adr/README.md)
- [Work definition](docs/discuss/work-definition.md) and [implementation plan](docs/PLAN.md)

## Development

```bash
pnpm install
pnpm dev                                        # server and editor with hot reload, ports printed at start
pnpm dev -- --config ../your-repo/ultrapaint.config.json   # against a configuration file
pnpm dev -- --ephemeral                         # save nothing
pnpm test && pnpm typecheck && pnpm lint
```

`pnpm dev` is `ultrapaint --dev` run from the checkout, with ports in 4600–4679 derived from the
checkout's path so several worktrees, and the installed command on 4770, run side by side. It
keeps its settings in `~/.ultrapaint` unless it is given `--config` or `--ephemeral`. Read
[`AGENTS.md`](AGENTS.md) before writing server code.

- `apps/web` — the editor (React, Tailwind, Base UI). It talks to the origin it is served from and touches nothing of the machine.
- `apps/server` — local backend on the Effect 4 runtime: settings, pages and canvases, design documents, component files and the design system, undo, git where there is one, the snapshot store, ACP threads.
- `packages/contracts` — Effect Schema for everything on the wire, the document format included, and the `RpcGroup` that is the editor's API.
- `packages/design-document` — the document format's pure code: tree walks, ids, the operations every edit is made of, tokens and the CSS a node is drawn with, a system component's look as CSS, an instance's slots (what fills each, how each lays it out), an app component's instance as the nodes it draws, a node's JSX with the classes a style system writes.
- `packages/framework-api` — what a framework and a style system give the server.
- `packages/preview-core` — the editor's frames (`Preview`), drawn in its page by a renderer mounted through `RenderToCanvas`: shadow roots, the design's look set once, what to draw, measuring, hit-testing, pictures, text editing, the prototype's navigation.
- `packages/system-components` — the editor's own components on Base UI (ADRs 0040, 0041): the catalogue over the component files (`catalogueOf`), their components, their default look, each frame's containment, and the conversion of what came before.
- `packages/renderer-react` — draws design documents with the editor's React: elements, system components and app components (`renderToCanvas`).
- `packages/figma-import` — reads a `.fig` file: its frames to design documents by fixed rules, with a mapping that says what each Figma component becomes, and its variables and styles as tokens.
- `packages/framework-react-vite` — the Node side for React + Vite: repository detection and the application a repository can start from.
- `packages/style-tailwind-v4` — the Tailwind v4 style system: tokens read from and written to `@theme`, the theme scan, what the code's classes use and their rewrite, the preview's stylesheet, a node's utilities for the Code tab.
- `packages/acp` — the only module that imports the ACP SDK, behind an `AcpAgent` Effect interface; agent launch configs are data.
- `packages/client-runtime`, `packages/shared` — the editor's RPC connection (reconnects, typed requests, events) and small utilities.
- `apps/desktop` — the desktop app: an Electron window around the same server and editor, its project list, the server it starts per project, the agents' adapters bundled and run on Electron's Node, the agents found, downloaded and signed in; `pnpm desktop:dev` and `pnpm desktop:build`.
- `scripts/command.ts` — the `ultrapaint` command, run from a checkout (with its `--dev` mode) or bundled into the release package by `scripts/pack.ts`; `scripts/cli.ts` is it on the PATH and `scripts/dev-runner.ts` is `pnpm dev`, that mode with development's ports and settings.

Storage verdict: [`docs/decisions/storage-format.md`](docs/decisions/storage-format.md).
Spike results: [`docs/feature/spikes/findings.md`](docs/feature/spikes/findings.md).
