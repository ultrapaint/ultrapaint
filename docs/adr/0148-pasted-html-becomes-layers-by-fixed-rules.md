# ADR 0148: Pasted HTML becomes layers by fixed rules

Status: accepted, 2026-11-25. Follows 0016 (a Figma frame is imported by fixed rules) and 0024
(the style system reads and writes classes).

## Context

A designer with a piece of a web page, a snippet an agent wrote, or a component's markup from
their code cannot bring it onto the canvas: they rebuild it by hand, layer by layer. The only
importer is the Figma one, whose rules read Figma's own nodes. UP-144 makes a paste of HTML on
the canvas make layers of it. This ADR holds the rules that turn markup into layers. How the
editor's paste reaches them comes in the story's third stage.

## Decision

- **A pure package, `html-import`, beside `figma-import`.** `convertHtml(document, { classes,
  designSystem, next })` turns any DOM `Document` (the browser's `DOMParser`'s in the editor,
  happy-dom's in tests) into design nodes and **warnings**, as `convertFrame` gives a root and
  its warnings, with the same id generator. It is not `design-document`, which has no DOM and
  never reads a style system's classes (ADR 0024), nor `figma-import`, whose rules are Figma's.
- **An element's style is its inline style over its classes, field by field.** The classes are
  read by the style system's class reader (`ClassReader`, ADR 0024), which `convertHtml` takes as
  an argument, as `toCode` takes a `ClassWriter`. The inline style is the longhands the DOM
  expands it into. Both are CSS declarations, folded into one form (`element-style`): a shorthand into
  sides, a border's and a corner's sides into one value where they agree (warned where they do
  not), a gap into both axes, a fill's image over its colour into `background`. Only inline
  styles and classes are read. A `<style>` block and a linked stylesheet would need a cascade the
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
    for the order only. Whether a group should place its children at their positions is asked
    on UP-144. A child positioned absolutely among others goes in the flow, warned.
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
  - **Fields** come from the look: size (pixels, `100%` as fill, `fit-content` as hug, growing in
    a flex as fill on its axis, stretching as fill across it; a percentage, `vw` or `calc` warned),
    its bounds, padding, margin, fill (a background image warned), border, radius, shadow,
    opacity, and the text settings. A text takes the text settings it does not set from the
    elements around it, as CSS inherits them.
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

## Consequences

- JSX is not HTML and makes no layers: its expressions, components and props would need rules
  of their own. `isJsx` tells it from HTML by its text (a component's tag, a fragment,
  `className=`, an expression as a value), for the paste to ask before it parses. A `button` never becomes the system component Button. Figma's import maps
  components through a mapping an agent makes, and pasted markup has none.
- Remote images are not downloaded: the URL is kept, and the image shows while it is reachable.
- Responsive and state variants are warned, not carried. Carrying them would need the paste to
  map the source's breakpoints onto the design system's.
- `packages/html-import` is in the `document` scope (`docs/agents/naming.md`).
