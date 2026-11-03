# ADR 0055: The editor redrawn, its design system and its shell

Status: accepted, 2026-11-03. Amends 0032 (the floating cards and the tools), 0053 (where the
mode is switched).

## Context

The editor had grown screen by screen: cool zinc greys, the system's font (a different face on
every machine, a generic one on Linux), every text at one size and nearly one weight, selected
rows in a wash of blue, and six floating islands (the title card, the rail card, a column of tools,
the actions, the right panel's tab, the zoom), with the mode toggle and the canvas picker stacked
under the project. Where the user was, what was primary and what was metadata read alike.

## Decision

- **The design system** is the editor's own and written in the repository's `DESIGN.md`: warm
  graphite neutrals in a dark theme and warm paper in a light one, on one set of roles; one colour,
  ultramarine, for what the user acts on (the primary button, a checked control, the tool in hand,
  focus); Onest (round, geometric forms) and Geist Mono, both loaded; seven type roles at four sizes
  (16, 14, 13, 12), the 13px `font-small` for what qualifies its neighbour and the 12px
  `font-caption` for keys, counts and badges; selection a neutral fill; fields filled and quiet;
  menus and dialogs on an overlay shadow. The mark is a U drawn as one stroke of paint.
- **The theme** follows the system's unless the person picks Light or Dark in Settings › Editor,
  kept in the browser. It colours the chrome only: designs keep their own themes.
- **The shell** is three floating cards and two bars over the canvas:
  - the left card, one card: the project (mark, name over branch), search (⌘K) and the panel's
    toggle; the canvas shown; an icon rail beside the panel, its places named by tooltips and by
    the panel's title, with Changes, Settings and who the user is at its foot. Put away, the card is
    the project's row alone;
  - the place switch at the top centre: **Canvas · Design system · Prototype**. 0053's two modes and
    the prototype workspace are said in one control, where the eye looks first; the toggle under
    the project and the Play button go;
  - the tools in one row at the bottom centre, the zoom at their end;
  - the right card: Design, Code and Comments as a segmented control, and its toggle.
- The rail's 10px labels go: nothing in the editor is set below 12px.

## Consequences

- Where the user is reads once, at the top; what they act on is the one blue thing on screen.
- The rail is smaller and the left card one surface, so the canvas gets the width the labels and
  the second card took.
- A machine without the system's font sees the same editor as a Mac.
- `font-rail` is gone; `typography.test.ts` keeps only the rule that no stock size is used.
