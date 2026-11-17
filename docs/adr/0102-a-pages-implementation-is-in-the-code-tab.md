# ADR 0102: A page's implementation is in the Code tab

Status: accepted, 2026-11-17. Amends 0030 (where the inspector shows a page's binding).

## Context

The right panel has two tabs, Design and Code. A page's link to the code that implements it (its
status, its files, what changed, the tokens waiting for the code, Implement, Mark ready and Mark
implemented) sat in the Design tab, as a Code section between the page's own fields and its
layout. The Design tab is where the design is changed; the code had a tab of its own, and the
person read the section there as code in the wrong place.

## Decision

- **The Design tab holds nothing of the code.** Its page section keeps the route, the viewport
  and the views.
- **A page's implementation is the Code tab's**: with a page selected, an Implementation section
  sits between the page's name and its code, with what the Code section held, unchanged. A node
  inside the page shows its code alone; the page's menu and the Pages panel keep their own ways to
  implement and to mark a page.

## Consequences

- The page's status and its actions are one tab away from its fields; Implement with an agent in
  the page's menu is still one click.
- The Code tab mounts only while open, so what changed in the design is asked for only while the
  tab is read.
