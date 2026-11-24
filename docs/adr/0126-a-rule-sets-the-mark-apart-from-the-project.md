# ADR 0126: A rule sets the mark apart from the project

Status: accepted, 2026-11-24. Amends 0107 (the title row's slash).

## Context

The title row put a slash, the character in the body face at its own angle, between the mark and
the project's button (ADR 0107). The person found the diagonal awful. They were shown, drawn in the
running editor in both themes, a thinner drawn slash, a thin vertical rule, space alone and a
chevron, and rows without the mark: the project first, the mark inside the project's button, and
the project and the canvas on one row. They keep the mark: it is the product's own, in its own
chrome, and a divider sets it apart from the project.

## Decision

- **The mark stays at the row's start**, at the rail's icons' size (18 px) and centred over the
  rail's column, so it reads as the head of that column.
- **A thin vertical rule** sits between the mark and the project: 1 px by 16 px in the border
  colour, a vertical separator to assistive technology.
- **The project's button is unchanged**: its icon, its name and its chevron, opening the project
  menu.

## Consequences

- The row's start and end are padded alike (6 px), the mark's box being a rail item's.
- On a Mac desktop window the window's buttons still come first, which moves the mark off the
  rail's column there.
