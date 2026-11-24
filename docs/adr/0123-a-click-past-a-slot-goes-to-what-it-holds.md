# ADR 0123: A click past a slot's node in a main component edited goes to what the slot holds

Status: accepted, 2026-11-24. Amends 0114 (a click inside a main component edited in place).

## Context

While a main component is edited in place (0114), what its instance's slots hold is not the
component's: a page's own nodes, or, a level in, a layer of the component around. The renderer
draws them under the page's other attribute (`data-ed-outside`), so the hit test stops at the
component's node that holds them. A click there selected that node, and every click after it
selected it again: the content in plain sight could not be reached without leaving the component
first and clicking it on the page. The person asked that every click do something, repeated clicks
reaching the deepest level, as in Figma.

## Decision

- **Past the slot's node, on to what it holds.** In a main component edited in place, a click on
  what a slot holds steps in as any click does, through the component's nodes to the one that
  holds it. A click once that node is selected leaves the component for the level what it holds
  belongs to, and selects it there: the page's own node on the page, a layer of a level around
  (`shell/label`) at that level by its own id (`label`). The outermost of what is held under the
  pointer is selected first, and further clicks go on into it as they do on the page.
- **Ctrl/⌘ or Alt goes there at once**, to the innermost node held under the pointer, as they go
  to the innermost node elsewhere (0114).
- A locked node is never selected this way: a locked component node cuts the chain short, so what
  it holds is not reached; a locked node held is skipped for the one around it, and with all locked
  the instance left through is selected.
- The frame answers what a slot holds under a point with `pageAt`, beside `hitTest`: the page's
  nodes inside the innermost component node there, empty anywhere else (the page dimmed around the
  instance is left by a click on it, as before).

## Consequences

- A click no longer stays in the component when the slot's node is selected and something is held
  under the pointer: what the slot holds is edited where it belongs, never in the component.
- Hovering in the component still outlines the component's nodes only; what a slot holds is
  outlined once it is selected, on the level it belongs to.
