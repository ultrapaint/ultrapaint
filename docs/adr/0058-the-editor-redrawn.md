# ADR 0058: The editor redrawn, its design system and its shell

Status: accepted, 2026-11-03. Amends 0032 (the floating cards and the tools), 0053 (where the
mode is switched). The faces are amended by 0070 (Cal Sans headings, Figtree text); the mark by
the brush-and-bolt of `docs/brand/`.

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
    the panel's title, with Changes, Settings and who the user is at its foot. The pages'
    comments are a place of the rail on the canvas, after Components, rather than a tab of the
    right card: they are the canvas's, not the selection's. Put away, the card is
    the project's row alone;
  - the place switch at the top centre: **Canvas · Design system · Prototype**. 0053's two modes and
    the prototype workspace are said in one control, where the eye looks first; the toggle under
    the project and the Play button go;
  - the tools in one row at the bottom centre of the window, the zoom at their end: centred on the
    window rather than on the canvas between the cards, so they stay put as the right card comes
    and goes;
  - over the tools while something is selected, its bar: an element's design-system selects (a
    component's variants, a text's style, the colour, radius, spacing and shadow tokens), a link
    and its menu; several elements' shared selects and Wrap in; a page's viewport, views and menu.
    On the canvas the selection keeps only its tag: its name and the agent's ✦ button, never wider
    than the element, the icon and ✦ alone on a small one. The bar that hung over the selection
    covered the frames around it when zoomed out and left the screen when zoomed in; docked, the
    controls are in one place at every zoom, as in Canva, and the one action that is about the
    element itself, asking an agent, stays on it;
  - the right card: Design and Code as a segmented control, and its toggle. It is drawn only
    while there is something to show in it: a layer or a page selected, several frames picked, or
    a board view, whose inspector always has. With nothing selected the canvas has the whole
    width; put away by the user, it is its bar alone while something is selected. The wait for a
    first selection as the editor starts goes with it.
- The rail's 10px labels go: nothing in the editor is set below 12px.

## Consequences

- Where the user is reads once, at the top; what they act on is the one blue thing on screen.
- The rail is smaller and the left card one surface, so the canvas gets the width the labels and
  the second card took.
- A machine without the system's font sees the same editor as a Mac.
- Comments are found where the other places of the canvas are, and the right card no longer
  stands open to say that nothing is selected.
- The selection's controls are a reach away from the element, at the bottom centre; zooming and
  panning never move them or put them over the design.
- `font-rail` is gone; `typography.test.ts` keeps only the rule that no stock size is used.
