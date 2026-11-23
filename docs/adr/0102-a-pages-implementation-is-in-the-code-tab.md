# ADR 0102: A page's implementation is in the Code tab

Status: accepted, 2026-11-17. Amends 0030 (where the inspector shows a page's binding).

> Amended by [0115](0115-a-design-is-brought-up-to-date-from-its-code.md), 2026-11-23: a page
> whose code changed has an Update from code button beside Implement, and a page not linked yet
> has it in the ⋯ menu.

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
  sits between the page's name and its code: the status, the files, what changed, the tokens
  waiting with Export, and Implement (Implement what changed) as its one button. A node inside the
  page shows its code alone.
- **What is done once or rarely is in the section's ⋯ menu**, the page menu's own entries under the
  same names: Find its code with an agent, Mark ready to implement or Mark not ready, Mark
  implemented… (again…), Unlink from its code. Marking a page is a step taken once in its life;
  implementing it is what the section is for.

## Consequences

- The page's status and its actions are one tab away from its fields; Implement with an agent in
  the page's menu is still one click.
- A page implemented has two entries in the ⋯ menu, under the three a menu should hold; the menu
  stays so the marks keep one place in every state.
- The Code tab mounts only while open, so what changed in the design is asked for only while the
  tab is read.
