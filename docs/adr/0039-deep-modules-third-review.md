# ADR 0039: What a third review found written in several places has one module too

Status: accepted, 2026-10-28. Follows 0037 and 0038, whose rule it applies again. Amends 0008 (a
checkpoint is a ref of the snapshot store, and a revert is one undo step that leaves the comments),
0011 and 0037's page-runtime line (the generated editor entry's exports and start-up are declared
and run in code), 0025 (how a token from another tool is named) and 0034 (the core owns a frame's
host). Plan: `docs/PLAN-architecture-3.md`, steps 1 to 18. The terms are in `GLOSSARY.md`.

## Context

A third review, over the whole repository, found concepts still written in several places. The
task texts named the editor's tools by string about 51 times past `agent-ways`, and told an agent
without the MCP server to call tools it did not have. Checkpoints kept a format of their own, and
a revert bypassed the edit journal that a snapshot's restore goes through. Tailwind's scales,
keywords and class grammar were written in four files of the style adapter. "The token with this
value" was looked up four times with four equalities, though 0037 gave the same value one rule.
The inspector and the element toolbar each read and wrote a node's fields, and disagreed on align.
Three modules wrote a frame's host, and the editor's wiped the page's. The generated editor
entry's exports and start-up order lived in string templates, and the preview server's config in a
script no test imported.

## Decision

Each such concept has one module, with an interface its callers and its tests share:

- **The editor's tools, named for the agent.** A text names a tool only through `agent-ways`,
  which knows whether the toolkits are offered and says what to do without them; the name is the
  tool's own.
- **Checkpoints.** A turn's checkpoint is a ref of a third namespace of the snapshot store; a
  revert puts the designs back as a restore does, one undo step, publishing what it writes and
  removes, and leaves the comments file as it is.
- **Tailwind's utilities.** One module of the style adapter splits a class and holds Tailwind's
  default scales and keywords both ways; the class writer and every reader of classes call it.
  Behind 0024's seam.
- **The token with this value.** The token table finds the tokens of a kind that hold a value, by
  token-value's equality, for Figma, the usage inventory and rewrite, and Sync; each keeps only
  its tie-break. Figma matches in every colour space.
- **A node's fields.** One table says how the inspector and the element toolbar read, write,
  label and offer each field they both edit.
- **The frame's host.** preview-core owns the host element: the editor's showing of a frame goes
  through the frame runtime, kept apart from what the page's code writes to it.
- **The preview server.** Its Vite config is built by one function the tests call; the script
  only listens.
- **The editor entry.** framework-api declares what the generated entry and the editor bundle
  export; preview-core runs the start-up in one call.

The candidates the review could not settle at once were investigated one at a time, and each
has one module too:

- **A token from another tool.** contracts' `token-naming` names it and finds its kind from the
  path and what the value is, for Figma and the Design Tokens file; the format's type decides
  where it says what the value is, a name drops only its kind's own words, and the scan places
  the code's tokens by the token table.
- **A frame's error and its drawing.** `editor-frame` keeps a frame's error whoever listens, of
  one `PageError` type; one hook draws a frame's request whenever it changes, for the canvas, the
  prototype and the specimens.
- **Frame gestures and the layout.** One module moves and sizes frames, and a cancelled or
  escaped gesture is put back; the layout is saved as it changes, only what changed, so a layout
  pushed meanwhile is kept; `reveal` brings a target into view.
- **A design target.** One rule names a page or a spec, a bare component name included, and one
  service reads and adds its behaviour notes. A thread's agent is switched, and a setup batch
  reverted, only once its turn is not running.
- **The desktop app's stop and the history.** A signal answers an open question "no" and stops;
  the server publishes the checkpoints and snapshots, which the Changes panel follows.

The desktop window gets no port: it would have one adapter, and its logic already sits behind
`Shell` and `WatchedContents`.

0037's rule on seams stands: no seam is added with one adapter. The frame's host gains a test
adapter (the scripted renderer under `createPreview` in happy-dom) beside the real renderer.

## Consequences

- Bugs found where copies had drifted are fixed, each with a test that failed first: an agent
  without the MCP server told to call its tools, a checkpoint revert that could not be undone and
  deleted comments, a value matched to a token in Sync and not in the inventory, an oklch token a
  Figma colour never matched, align read and written two ways, a page's `dark` class lost on
  reopening its frame.
- Renaming a tool, an export of the editor entry or a file of the generated preview fails to
  compile or fails a test rather than failing at run time.
- What the preview server does to a module is tested in the test run, not only by
  `pnpm e2e:sandbox`.
- The investigated candidates' bugs are fixed the same way: a Design Tokens `Corner.sm` dropped,
  Figma's `Color/Text/Primary` taken for the brand colour, the repository's inset, drop and text
  shadows dropped by `/init`, a frame's error lost when it is panned away, a specimen blank after
  the preview restarts, a layout an agent pushed undone by a save, a note on a node reference
  landing on its page, a prompt lost to an agent switched as it was sent, a batch reverted under
  the agent writing it, a signal waiting for an answer, a turn's checkpoint missing from Changes.
