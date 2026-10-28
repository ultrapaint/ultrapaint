# ADR 0039: What a third review found written in several places has one module too

Status: accepted, 2026-10-28. Follows 0037 and 0038, whose rule it applies again. Amends 0008 (a
checkpoint is a ref of the snapshot store, and a revert is one undo step that leaves the comments),
0011 and 0037's page-runtime line (the generated editor entry's exports and start-up are declared
and run in code) and 0034 (the core owns a frame's host). Plan: `docs/PLAN-architecture-3.md`,
steps 1 to 8. The terms are in `GLOSSARY.md`.

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
- The review's other candidates (a token's name from another tool, a frame's drawing, frame
  gestures, a design target, the desktop window) are investigated one at a time before they are
  planned.
