# ADR 0053: Canvas and Design System, two modes

Status: accepted, 2026-11-03. Supersedes 0052; amends 0045 (the rail and the way to the boards).

## Context

Design system and the Library opened a board view in place of the page canvas (0045), from the
same rail as Layers and the agents. Where the user was said nothing on the screen but the panel
open, and the way back was bolted on: a "Back to" line in two panels, then Layers on every board
and Escape stepping out (0052). It read as getting lost in a place the rail had led to by accident.

## Decision

- The editor has two modes, switched by a toggle under the project, over the canvas selector: **Canvas**, the pages
  of the canvas and what is placed on them, and **Design System**, the design system's foundations,
  guidelines and components on boards. The mode is Design System exactly while a board view is
  open; nothing else keeps it.
- The rail shows the mode's places. Canvas: Agents, Layers, Components (the list placed from),
  Changes. Design System: Agents, Foundations (the tokens and the guidelines, with Sync),
  Components (their boards), Changes; on an app component's board Layers follows Components, for
  the tree edited in place.
- Design System opens the foundations where they were left. Canvas, picking a canvas (the one
  shown too) or the browser's back takes the page canvas back as it was left.
- The command palette offers every panel; one of the other mode switches to it.
- The "Back to" line, Layers on every board and Escape stepping out of a board view (0052) go.
  The dot that says the design system and the code need syncing is on the toggle's Design System
  as well as on Foundations, so it is seen from the canvas.

## Consequences

- Where the user is reads in one place, the toggle, and the rail never offers a panel of the other
  mode.
- "Library" and "Design system" are, on screen, Components and Foundations; the code keeps the
  panels' ids (`library`, `designSystem`).
