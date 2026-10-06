# ADR 0026: Pages are written one node per line, and drawn as PNGs beside them

Status: accepted, 2026-10-06. Amends 0015 (design documents).

## Context

A page has been a design document since 0015, not React code: a tree of nodes the renderer turns
into React elements at run time, with the repository's real components for its instances. The
format stays. How it was written did not hold up: `JSON.stringify(value, null, 2)` put every field
of every node on a line of its own, nested as deep as the tree. This repository's own designs ran
to 8,800 lines and 470 KB for one page, a change of one colour in the inspector was a diff a
reviewer had to find among braces, and nobody could read the tree from the file.

Nor could anyone see a screen without running the tool. A reviewer of a pull request, or someone
browsing the repository, saw JSON.

Two other ways of saving were weighed and left:

- **SVG as the saved format.** An SVG is a picture of what the components drew, not the
  document: SVG has no layout, so `fill`, `hug`, `gap` and alignment would be frozen into
  positions, and an instance would be the Button as it looked that day rather than a reference to
  the Button. Reading it back cannot give the same design, and the design would stop following
  the components. Carrying the document inside the SVG's `<metadata>` makes it a JSON file with a
  picture attached, whose every edit rewrites the picture.
- **A markup of our own** (XML-like, a node per element). About 20% smaller than JSON a node per
  line, and as readable, but it needs a codec that knows the schema (a number or a string, sides
  and borders as attributes), a parser, and a specification agents learn. The JSON form gives most
  of the gain at none of that cost.

## Decision

**A page file is JSON written a node per line** (`@ultrapaint/design-document/format`,
`serialiseDocument`). A node's own fields are on its line, in a fixed order — `type`, `id`, `name`,
then the rest by name, `children` last — and its children follow one level deeper, each on its
own line. A canvas's `canvas.json` writes its loose nodes the same way and its other fields as
before. The file is still JSON: every reader, the schema `get_document_format` publishes, and a
file an agent writes by hand are unchanged, and the server rewrites a file in this form the next
time it changes it. Writing a document twice gives the same bytes, and reading what was written
gives the document back: a test checks both on every page of this repository and on generated
documents.

This repository's designs went from 47,600 lines to 6,600, and from 2.4 MB to 0.75 MB.

**A PNG of every page, when the project asks for it.** `pagePngs: true` in the configuration file
(or **PNG of every page** in Settings → Repository) has the server keep `<name>.page.png` beside
every `<name>.page.json`:

- Drawn by an open editor's preview, as `get_screenshot` is, at the size of the page's frame,
  with the repository's components and stylesheet. The server has no browser.
- Each PNG carries, in a `tEXt` chunk, a key of what it was drawn from: the page's file, the
  design system, the frame's size and the theme. A pass, a moment after anything that can change a
  picture (a document, a canvas, the page list, the design system, an editor arriving), draws only
  the pages whose key differs. A page that did not change is never rewritten, so it never shows as
  a change in git.
- A page changed while no editor is open keeps its old picture until one opens.
- A PNG whose page is gone is removed when it carries our key; a PNG we did not write is left
  alone. Turning the setting off stops the drawing and leaves the PNGs where they are.

## Consequences

- Pull requests show a page as a one-line-per-change diff, and, with `pagePngs`, as an image diff
  of the screen.
- A repository-wide JSON formatter (Prettier, Biome) reformats page files unless the designs
  directory is excluded from it; the server reads either form and writes its own back on the next
  change. This repository excludes `docs/designs/**/*.json` from Biome's formatter.
- What a component looks like is not part of a PNG's key: a component restyled in the code is
  redrawn the next time its page, its frame or the design system changes.
- PNGs are binary files in git history. They are written only when a page changes; a project
  that minds the weight can put `*.page.png` under Git LFS.
