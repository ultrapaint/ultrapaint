# ADR 0052: The way back from a board view

Status: superseded by 0053, 2026-11-03. Amended 0045 (the rail on a board view).

## Context

Opening Design system, or a component in the Library, shows a board view in place of the page
canvas (0045). The way back was a "Back to" line at the top of those two panels, and the rail
dropped Layers on a board with no tree. Once on a board, a user who opened another panel (the
chat, the changes) had no Back line and no Layers: nothing on screen led to the pages, and Escape
only let go of what was picked.

## Decision

- The rail lists every place on every surface. A place the board view does not show itself
  (Layers, on a board with no tree) leads back to the page canvas, with that panel open; the
  command palette offers it too. On an app component's board Layers shows its tree, as before.
- Escape steps back out of a board view: once nothing is picked or selected there, it goes back to
  the page canvas as it was left, as "Back to" does.
- The "Back to" line stays at the top of the Design system and the Library panels.

## Consequences

- The rail never changes as the surface does; Layers is always the way to the pages.
- A board view is left by the same keys and clicks as anything else in the editor, one step back
  at a time.
