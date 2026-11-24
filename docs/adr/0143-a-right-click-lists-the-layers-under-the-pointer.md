# ADR 0143: A right-click lists the layers under the pointer

Status: accepted, 2026-11-24.

## Context

A click on the canvas takes one node of the chain the preview's hit test answers with: the
selection when the point is inside it, else one step further in than the selection goes
(`stepInto`), or the innermost with Alt or Ctrl/⌘. Nothing in between is reached in one go, and
the element's menu offered only Select parent, a level at a time. A card's title inside a list
inside a column took three or four clicks, or a hunt in Layers. The editor had every layer under
the point all along (`chainAt`, the frame's `hitTest`), cut at the first locked one
(`hitUnlocked`), and dropped all but one.

## Decision

- **Select layer, in the element's menu.** A right-click on the canvas opens the element's menu
  with a Select layer submenu beside Select parent: the **layers under the pointer**, the deepest
  first and the frame's root last (a page, or a node placed beside the pages), each named as
  Layers names it (`nodeLabel`; a page by its name), the selected ones ticked.
- **The chain a click sees.** The list is the hit test's chain at the right-clicked point through
  `hitUnlocked` (`layersUnder`): a locked layer and what it holds are not there, nor a hidden
  one. An instance's layers are listed as its main component's tree names them (ADR 0114).
- **A pick selects alone, in the view right-clicked in.** `selectLayerUnder` selects the layer as a
  click would, in that frame, so a view's breakpoint stays (ADR 0036); the page's row selects the
  page (ADR 0075). The right-click still takes the menu's node as it did (`selectForMenu`).
- **Only with a point.** A menu opened without one (the menu key or ⇧F10, a Layers row, a frame's
  header, the command palette's selection) has no Select layer, and neither has a list of one
  layer.
- **The model stays pure** (ADR 0037): `NodeFacts.layersUnder` is a fact read off the stores by
  `menu-actions`, the submenu `layers` carries lucide's Layers icon.

## Consequences

- Any layer under the pointer is one right-click and one pick away, an instance's too.
- Two siblings drawn over each other are not both listed: the chain is the ancestors of the one
  element under the point. Listing them would need a hit test of every element there, which is a
  change of hit testing, not of the menu.
- A pick selects one layer; Shift-click on the canvas and in Layers stay the way to add to a
  selection.
