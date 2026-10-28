# Glossary

The names this repository's modules are given, for the concepts they own. The decisions behind
them are in `docs/adr/`; [ADR 0037](docs/adr/0037-deep-modules.md) says why each concept has one
module.

## Design

- **Design system**: the tokens, typography, components and looks a canvas is drawn with,
  kept in `design-system.json` (everything but values) and `design.tokens.json` (every token's
  value) (ADRs 0028, 0035). Read and written by the server's `design-system-files` codec.
- **Token**: a named value of the design system (`color-primary`, `text-xl`, `radius-md`), of a
  **kind** its name's prefix says. The **token table** (contracts' `token-table`) says which list
  of the design system holds each kind; the **spacing base** is the token named `spacing`.
- **Token value**: what a token holds, read as a colour, a length, a duration, a number or text
  (contracts' `token-value`), with one notion of the same value.
- **Side**: somewhere else a design system's tokens live: the code, Figma, DESIGN.md (ADRs 0025,
  0027, 0028). Each is compared with the design against its **baseline**, what the two last
  agreed on; the **agreement** rule gives a token's outcome. The **sync engine** compares any
  side; a **side adapter** says how one side is read, matched and kept.
- **Page**: a design document, `.page.json`, of a **canvas** (ADRs 0015, 0019, 0020). A page is
  drawn in a **frame**, and in **views** of other widths beside it (ADR 0036); an edit lands at
  the **breakpoint** of the view it is made in.
- **Snapshot**: a named point in the designs' history (ADR 0019), a ref of the `designs`
  namespace in the tool's **snapshot store**.

## Agents

- **Thread**: a conversation with an agent about a scope; a **turn** is one prompt and what the
  agent does with it. A thread's **session** (`ThreadSession`) holds its live state and status;
  a thread is **busy** while a turn runs or is being stopped (`isBusy`).
- **Card**: what the agent waits on the user for, a permission or a question
  (`PendingCards`, ADR 0022).
- **Agent launcher**: the seam an agent is started through: its sandboxed process (ADR 0013),
  or a scripted in-memory agent in tests.
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
