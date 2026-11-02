---
name: ultrapaint
description: "Ultrapaint's design rules. Use to design or review an interface: a screen, a page, a component's look, a design system."
---

# Ultrapaint

How to design an interface well, as the people it is made for judge it. Character, hierarchy and
restraint hold on every screen and are read with this file. Every other part of a design has its
reference in `references/`.

A *screen* is a product's own interface: a dashboard, a form, settings. A *page* is public: a
landing page, a shop, a portfolio, a magazine. A rule that names one holds for that one.

## On every screen

- One sans for the interface, the product's own face and actually loaded: a neo-grotesque or
  geometric (Inter, Geist), or a mono for a technical product. A serif only for a page's display
  headlines, when the brand asks for one.
- Neutrals are neutral or warm.
- Two text colours, plainly apart: titles, names, values and labels in the foreground; hints,
  descriptions, metadata and placeholders muted. A field's label is semibold.
- A badge is neutral; only its dot or arrow takes a colour. A chart's series are named on the
  chart.
- Groups sit on a quiet surface of their own; a control inside a sentence or a row is its text
  and a chevron.
- Less is more: what the content already says is cut (restraint, below).

## Steps

1. **Name the character**, technical, humanistic or expressive, from the design system and the
   brief (`references/character.md`). It sets the dials the other references leave open.
2. **Name the screen's one job** and its primary action in one sentence
   (`references/hierarchy.md`).
3. **Read the four every screen has**, before the first node: `references/layout.md`,
   `references/spacing.md`, `references/typography.md`, `references/color.md`.
4. **Read the pattern** when the screen is a kind `references/patterns.md` lists: a dialog,
   settings, a table, a landing page.
5. **Read each reference the screen reaches**, from the table below, before you place that part.
6. **Finish with the check.** Run the "Before you finish" table of every reference you read
   against every screen, and fix what fails. Your last message names each reference you read and
   says its table holds. A screen with type, colour, spacing or a layout whose reference is not
   in that list is not finished.

## When the screen has one

| It has | Read |
| --- | --- |
| Surfaces, shadows, what sits above what | `references/elevation.md` |
| Borders, dividers, radius | `references/borders.md` |
| Icons | `references/iconography.md` |
| Movement and transitions | `references/motion.md` |
| Words: headings, labels, buttons, errors, empty states | `references/content.md` |
| Loading, empty, error and the other states | `references/states.md` |
| The design system's components | `references/components.md` |
| The design system itself: tokens, faces, components made or restyled | `references/design-system.md` |
| An attached picture to make it from | `references/picture.md` |
| Keyboard, screen reader, contrast, targets | `references/accessibility.md` |
