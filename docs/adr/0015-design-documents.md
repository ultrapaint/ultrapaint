# ADR 0015: Design documents replace TSX pages

Status: accepted, 2026-09-25. Supersedes 0002, 0003, 0007's snippet insertion and the TSX
verdict of [the storage checkpoint](../decisions/storage-format.md). Amends 0011, 0012 and 0014.

> Amended by [0019](0019-canvases.md): a space is a canvas, and an image's `assets/` is the
> canvas's own when it has that file, the shared one at the root of the designs directory
> otherwise.

## Context

A page was a React module and the canvas edited it as JSX: a stamping plugin wrote source
locations into every element, the preview walked React's fibers to rebuild a tree, and every
inspector change was a surgical AST edit followed by the repository's formatter. It worked, and
it was the least reliable part of the tool: a computed `className` refused an edit, a component
forwarding its props moved the stamp to an element the user never wrote, positions shifted after
formatting, and a move between files had to carry imports and helpers along. The layers panel
showed one page at a time because the tree only existed inside that page's iframe.

What we want to design is not arbitrary code. It is boxes laid out in rows and columns, text,
images and instances of the design system's components — and then a coding agent turns that into
the application's own code, in its own conventions.

## Decision

**A page is a document the tool owns.** `<route>.page.json` in a space is a tree of nodes:

| Node | What it is |
|---|---|
| `page` | The root of a file. Lays its children out as a column. |
| `group` | A plain container: its children stack in normal flow. |
| `row`, `column` | Flex containers: gap, alignment on both axes, wrap, padding. |
| `text` | A heading (levels 1–6) or a paragraph, optionally set in a text style. |
| `image` | A file in the space's `assets/`. |
| `instance` | A component of the design system: `component` and `from` name it, `props` configure it, `text` or `children` fill it. It renders with the repository's real component. |

Every node has a stable `id` and the same box properties: `width` and `height` as `fixed`
pixels, `fill` or `hug`; minimum and maximum; `padding`; `fill`, `border`, `radius`, `shadow`,
`opacity`; `hidden`; and a `link` to a route, which is what the prototype follows. Values are
numbers (pixels), plain CSS, or **tokens** of the design system: `"$color-primary"` is
`var(--color-primary)`.

A node's position is its parent's to decide. Inside a page it follows the layout of the
container it is in. Placed directly on the canvas, beside the pages, it has an `x` and `y` of
its own; those loose nodes live in the space's `canvas.json`, next to the frames of the pages.

**Only Tailwind v4 is supported.** Token names are the variable names of Tailwind v4's `@theme`
(`--color-*`, `--spacing`, `--text-*`, `--font-*`, `--font-weight-*`, `--leading-*`,
`--tracking-*`, `--radius-*`, `--shadow-*`), so the utility a token becomes follows from its name
and nothing has to record it.

**The design system is imported by an agent.** `/init` in a thread — or **Initialise** in the
Design system panel or in Settings, which opens a thread with `/init` in the composer, unsent —
asks the agent to call `scan_design_system` (a fixed-rule scan of the `@theme` blocks and the
catalogue), explore what the scan cannot interpret, ask the user about the application, and
write the result through `write_design_system`, which validates it. It writes:

- `design-system.json` at the root of the designs directory: grouped colour tokens (palettes
  and semantic colours, with a value per theme when the repository has themes), typography
  (families, sizes, weights, leading, tracking, and named text styles), the spacing base,
  radii, shadows, and per component a category and example props;
- `DESIGN.md` beside it: the conventions, in prose. Every briefing includes it.

Running `/init` again updates both. **Detect automatically** runs the scan alone, for users
without an agent.

**The editor owns the tree.** The layers panel shows the whole space — every page and every
loose node — from the documents themselves, not from the DOM. Every change is an operation on a
document (`insert`, `remove`, `move`, `update`, `setProps`, `wrap`, `unwrap`, `duplicate`),
applied by one pure implementation in `@ultrapaint/design-document` on the server; an action
spanning several documents is one request and one undo step. Agents change documents through the
same operations over MCP (`read_document`, `apply_operations`), or by writing the file, which the
server validates and reports on.

**The preview renders documents.** The editor sends the document to the iframe
(`ed:render`), and the renderer turns it into React elements with inline styles; instances are
imported from a generated registry of the component modules the catalogue and the documents
name. There is no stamping, no fiber walk and no source editing. Every rendered node carries
`data-ed-node`, which is all hit testing and measuring need. `PREVIEW_PROTOCOL` goes to 5.

An instance's box fields (size, padding, fill, border…) are the component's own, as they are in
the code, where they are classes in its `className`. The renderer gives them to the component as
`style`, with `data-ed-node`, and a component that passes its props on to its root element puts
them there: nothing of ours stands between the component and its parent, so its own selectors
(`*:`, `has-[>…]`, grid placement) see the page as the application would. A component that keeps
its props to itself is found out after the first commit and drawn inside a wrapper that carries
the box; the Code tab then writes the same wrapper, and the inspector says so. An instance's
children are sized against the element of the component that holds them, read off the DOM:
`fill` inside a Card that is a flex column grows, as `flex-1` would. The preview reports both
with `ed:instances`. Where a `fill` has no room to take — its parent's size follows its content —
the inspector and `apply_operations` say so (`@ultrapaint/design-document/sizing`).

**Code is written by an agent.** `/implement` (or **Implement** on a page) starts a thread whose
prompt carries the document, the design system and the rules that turn one into the other:
nodes into the design system's components and elements, tokens into Tailwind utilities. There is
no code generator to keep in step with every repository's conventions.

## Consequences

- TSX pages, `_router.tsx`, the canvas items' `_canvas/*.tsx` modules, the JSX source editor,
  the stamping plugin and the React introspector are gone. A designs directory written before
  this has to be redrawn; nothing converts it.
- The format is ours to keep compatible: `version` is in every file, and the schema is published
  to agents through the MCP server.
- The component palette shows components as a list or as a grid of thumbnails. Thumbnails are
  rendered by our own preview with the example props init wrote, and cached in the state
  directory under a hash of the catalogue and the design system.
- The Design system panel shows what was imported: colours, typography samples rendered with the
  repository's own stylesheet, spacing, radii and shadows, and `DESIGN.md`.
- The right panel's **Code** tab shows the selected node, and everything in it, as JSX with the
  design system's components and Tailwind v4 utilities (`@ultrapaint/design-document/code`). It
  is the reference translation of the rules above, for reading a design as code and seeing why
  it draws as it does; nothing is written to the repository, and the application's code is
  still the agent's. The rules and the translation change together.
- Breakpoints and rich text are not part of the format yet.
