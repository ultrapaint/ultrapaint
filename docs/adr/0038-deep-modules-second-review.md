# ADR 0038: The concepts ADR 0037 left half-done have one module too

Status: accepted, 2026-10-28. Follows 0037, whose rule it applies again. Amends 0024 (a
`ClassWriter` takes a node's declarations), 0029 (a spec read off the code is linked on every
path) and 0031 (a built-in agent is one descriptor in `acp`). Plan:
`docs/PLAN-architecture-2.md`, steps 1 to 13. The terms are in `GLOSSARY.md`.

## Context

A second review, the day after 0037's steps were built, found what those steps had left
half-done and concepts still written in several places. The Sync engine compared every side, but
what each side knows (the code's tokens and their cache, Figma's baseline, DESIGN.md's document
and baseline) still sat in `DesignSystemService`, whose interface had 17 members; the code's
tokens were read past its cache at five places, and "the design's tokens, else the code's" was
written twice. Where a frame goes on a canvas was decided in four places with two gaps, and a
new page could land on another page's views. Nine web stores wired themselves to the server, and
after a reconnect only the project was read again. "Selected here" had two rules and "which
breakpoint a frame is at" six, so the toolbar showed a view's nodes at the base. The spacing
scale and a length in pixels were still copied across five packages, and the web never used the
token table. The canvas's style and the Code tab's classes were derived twice from a node's
fields. A built-in agent's facts were in seven files, with "not Claude" taken to mean Codex. And
a project service could only be tested through a socket and a live preview.

## Decision

Each such concept has one module, with an interface its callers and its tests share:

- **The server.** `composition.ts` builds the server and the tests from one stack;
  `HostManager.layerTest` is the host seam's second adapter, and `ProjectTest` opens a project
  in-process with every service and the MCP toolkits' handlers. `ProjectManager` applies the
  settings in force (open, reopen or nothing, decided once) and publishes the project's info.
  Flows live in their services (a spec read off the code is linked, a commit publishes the git
  status, a page's deletion says what it removed); the RPC handlers and the MCP tools route.
- **The design system's sides.** `DesignSystemService` keeps the design, its writes one at a
  time and one publish after a change; `CodeSide`, `DesignMd` and Figma's baseline own what each
  side keeps, behind 0037's side seam.
- **Canvas layout.** contracts' `canvas-layout` places a frame (past every page's views), a
  view, names a view and lists a page's family, for the server, the MCP tools and the web.
- **Tokens.** The token table owns the spacing scale and reads a kind for every caller;
  `token-value` owns a length in pixels, `var()` and `calc()`.
- **A node's style.** design-document says a node's CSS declarations per breakpoint; the canvas
  draws them and a style system's `ClassWriter` writes classes from them, its variant prefixes
  its own. A test checks over the fixtures that the two agree.
- **Built-in agents.** Each is one descriptor in `acp` (launch, adapter, sign-in and its parser,
  key, environment); the desktop, its bundling and the server's launches read the list.
- **The web.** `server-data` follows what the server pushes, reads it again at every connection
  open and reads a viewed snapshot in place of what a snapshot keeps; `selection` has one rule
  for "selected here" and gives nodes as their view draws them; `threadView` says how a thread
  is shown; `showLeftPanel` opens a left panel on something; `layer-tree` decides a Layers drop
  and a reveal.

0037's rule on seams stands: where a seam was added it has two adapters (the host: the preview
and none; server data: live and a snapshot; built-in agents: Claude Code and Codex).

## Consequences

- Bugs found where copies had drifted are fixed, each with a test that failed first: a new frame
  on another page's views, the web's stores stale after a reconnect, the toolbar's values inside
  a view, Shift-click across views, a stopping thread missing from the rail, "Add to chat" with
  the panel put away, settings saved unchanged restarting the preview, stale settings after
  Sync's detection, a spec read alone left unlinked, a comment's author read once, tinted icons
  written without their mask. Writing a canvas's frames no longer drops its `defaults`.
- Most server behaviour is tested in the server's process through `ProjectTest`; the harness
  over a socket stays for what crosses the wire.
- A review that finds one of these concepts written in a second place gives the module the
  change rather than adding a copy.
