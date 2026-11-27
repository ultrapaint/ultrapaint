# ADR 0148: Pasted HTML becomes layers by fixed rules

Status: accepted, 2026-11-25. Follows 0016 (a Figma frame is imported by fixed rules) and 0024
(the style system reads and writes classes). Amended 2026-11-27 by
[0163](0163-a-text-holds-runs-that-link-or-underline.md): an inline link and an underline are
kept as the text's runs, and are not warned; bold, italic and other inline styles are still
flattened.

## Context

A designer with a piece of a web page, a snippet an agent wrote, or a component's markup from
their code cannot bring it onto the canvas: they rebuild it by hand, layer by layer. The only
importer is the Figma one, whose rules read Figma's own nodes. UP-144 makes a paste of HTML on
the canvas make layers of it. This ADR holds the rules that turn markup into layers, and how the
editor's paste reaches them.

## Decision

- **A pure package, `html-import`, beside `figma-import`.** `convertHtml(document, { classes,
  designSystem, next })` turns any DOM `Document` (the browser's `DOMParser`'s in the editor,
  happy-dom's in tests) into design nodes and **warnings**, as `convertFrame` gives a root and
  its warnings, with the same id generator. It is not `design-document`, which has no DOM and
  never reads a style system's classes (ADR 0024), nor `figma-import`, whose rules are Figma's.
- **An element's style is its inline style over its classes, field by field.** The classes are
  read by the style system's class reader (`ClassReader`, ADR 0024), which `convertHtml` takes as
  an argument, as `toCode` takes a `ClassWriter`. The inline style is the longhands the DOM
  expands it into. Both are CSS declarations, taken apart into the same components (a shorthand
  into its sides, a gap into its axes, a whole border and radius into each side's and corner's, a
  fill into its image and its colour), met with the inline style winning and its resets
  (`initial`) taking a class's value back, then folded into one form (`element-style`): a
  border's and a corner's sides into one value where they agree (warned where they do not), a
  fill's image over its colour into `background`. Only inline styles and classes are read. A `<style>` block and a linked stylesheet would need a cascade the
  rules do not run.
- **The rules:**
  - `display: flex` or `inline-flex` becomes a row, or a column for a vertical direction, with
    its gap along its axis, its alignment, its alignment across and its wrap. Each of its
    children is a node of its own, as each is a flex item. A reversed direction is laid out
    forwards and warned.
  - `display: grid` becomes a column with its row gap, warned.
  - Another element holding elements becomes a column, as normal flow stacks them. When every
    child is positioned absolutely, it becomes a group, its children stacked in reading order
    (top, then left) and warned, as the Figma import stacks a frame laid out freely. The page
    format places nothing inside a page (`place` in `ops`), so their `left` and `top` are read
    for the order only. Chosen with the person on 2026-11-25. A group placing its children at
    their positions is UP-202, which the paste takes up once the format holds it. A child
    positioned absolutely among others goes in the flow, warned.
  - An element holding only words (text, and inline elements holding only words) becomes a text,
    `br` a new line. An inline element whose display is a block, a flex or a grid, or that is
    positioned absolutely, is not a word. Its inline formatting (a bold, an italic, a link, a span
    with a style of its own) is flattened into its text and warned, and the classes of what was
    flattened are counted as any element's are. Words not shown (`hidden`, `display: none`,
    `sr-only`) are left out. `h1`–`h6` become a heading of that level, everything else a paragraph. A run of
    words between blocks is a paragraph of its own. An inline element alone between blocks keeps
    its own look (a link styled as a button).
  - `img` becomes an image with its `src` as given and its `alt`, its `width` and `height`
    attributes as its size. A `data:` image is left out and warned.
  - `svg`, `canvas`, `video`, `audio`, `iframe`, `object`, `embed` and the form controls
    (`input`, `select`, `textarea`) are left out and warned. A `button` keeps its look, as a text
    or a container, and its behaviour is warned.
  - `script`, `style`, `head`, `template`, `noscript`, comments, `display: none`,
    `visibility: hidden`, `hidden` and `sr-only` are dropped without a warning: they show
    nothing.
  - **Fields** come from the element style: size (pixels, `100%` as fill, `fit-content` as hug,
    growing in a flex as fill on its axis, stretching as fill across it where that size is `auto`
    and neither margin across is; a percentage, `vw` or `calc` warned), its bounds (a maximum of 0
    kept), padding, margin, fill (a background image warned), border, radius, shadow, opacity, and
    the text settings, a line height in pixels keeping its unit. A text takes the text settings it
    does not set from the elements around it, the body's included, as CSS inherits them. A hidden
    body shows nothing.
  - **Values** are written as the design system's token where it has one for the value: the first
    token of the field's kind that holds it, in any unit or colour space (`tokensByValue`), and a
    spacing as its step of the scale first (`16px` on a 4px base is `$spacing-4`), then a named
    spacing. A value with no token stays as it is, and the inspector's dot and the design checks
    show it as off the system (ADR 0061). A type size token's paired line height is left to it.
- **The warnings are counted by kind** (`warnings`): each kind once, with how often it was met and
  how it is said ("a grid laid out as a column"). They include the classes the class reader did
  not read and those with a variant (`md:`, `hover:`). Layout a page's stylesheet gave is not on
  the clipboard, so it is told as classes not read.
- **HTML in which nothing could be carried gives no nodes**, and its warnings say why.

- **The paste.** ⌘V stays the key (ADR 0090), taken by the editor's clipboard listener when
  nothing that takes text has the focus, so a paste in the chat's composer, a field or a dialog
  pastes there (ADR 0064). Its order (the web's `paste-markup`):
  - The editor's own copied nodes paste as themselves, first, as before.
  - A clipboard holding image files is left to the canvas, which places them. A browser copying a
    picture puts HTML beside it, which never makes an `img` layer instead.
  - `text/plain` whose trimmed text starts with `<` and parses into an element is the markup. A
    code editor copies markup so, and the HTML it puts beside it is the code's highlighting.
  - Else `text/html`, a browser's copy, whose plain text is only the words it shows. HTML whose
    every block it shows is a `pre` or has `white-space: pre` (VS Code's and JetBrains' copies,
    their `<meta charset>` aside) is a code editor's highlighting of code that is not markup, and
    pastes nothing. A browser's copy of words alone (a word from a page, a chat or a doc, as a
    span) pastes as a text layer with the styles it was copied with: chosen with the person on
    2026-11-25 over pasting nothing.
  - JSX (`isJsx`) makes no layers, and the toast says so. Plain text that is not markup, with no
    HTML beside it, pastes nothing, as before.
  - The classes are read as Tailwind's, whatever the project's style system: markup on the web is
    written with them.
- **Landing.** The layers go where a paste of nodes goes, through `insertNodes`: into the selected
  container, after the selected element, or at the end of the page, from the view's breakpoint up
  (ADR 0036), in one `applyEdits` labelled "Paste", and what landed is selected. The layers are
  the clipboard's then, so the canvas's Paste pastes them again, as after a paste of nodes.
- **The toast** says how many layers were pasted ("Pasted 12 layers") and what was not carried,
  each kind once with its count ("Not carried: 4 classes not read, a grid laid out as a column.").
  It is shown once the layers landed. Nothing carried pastes nothing and says why ("Nothing to
  paste"), and so does a paste with nowhere to land, no page and nothing selected.

## Consequences

- JSX is not HTML and makes no layers: its expressions, components and props would need rules
  of their own. `isJsx` tells it from HTML by its text (a component's tag, a fragment,
  `className=`, an expression as a value), for the paste to ask before it parses. A `button` never becomes the system component Button. Figma's import maps
  components through a mapping an agent makes, and pasted markup has none.
- Remote images are not downloaded: the URL is kept, and the image shows while it is reachable.
- Responsive and state variants are warned, not carried. Carrying them would need the paste to
  map the source's breakpoints onto the design system's.
- `packages/html-import` is in the `document` scope (`docs/agents/naming.md`).
