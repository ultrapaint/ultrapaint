---
name: ultrapaint
description: "Ultrapaint's design rules. Use to design or review an interface (a screen, a page, a component's look) or to make its design system: create one, extract it from a product's code or pictures, import it from Figma, build its components."
---

# Ultrapaint

How to design an interface well, as the people it is made for judge it. There are two jobs:
designing a screen or a page with the design system it is given, and making that design system.
Character, hierarchy and restraint hold on every screen and are read with this file. Every other
part has its reference in `references/`.

A *screen* is a product's own interface: a dashboard, a form, settings. A *page* is public: a
landing page, a shop, a portfolio, a magazine. A rule that names one holds for that one.

## On every screen

- Text in the design system's face and styles, never a size or a colour of its own: one sans,
  loaded, Inter or Geist when nothing names one. A serif only for a page's display headlines,
  unless the user asked for one.
- Neutrals neutral or warm, unless the user asked for a cool feel.
- Two text colours, plainly apart: titles, names, values and field labels in the foreground;
  hints, descriptions, metadata and placeholders muted. A field label is semibold; control text
  (navigation, tabs, buttons) medium.
- A badge is the system's neutral Badge; a status adds a small coloured dot inside it. A chart's
  series are named on the chart.
- Groups sit on a quiet surface of their own; a control inside a sentence or a row is its text
  and a chevron.
- Less is more: what the content already says is cut (restraint, below).

## Designing a screen or page

1. **Settle the character** (`references/character.md`): read it in DESIGN.md; else from the
   product, the picture or the request; else ask the user once whether to decide from the request
   or hear it described. Write it down before the first node. It sets the dials the other
   references leave open, and what the user said wins over their defaults.
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

## Making the design system

Creating one, reading one off a product's code or pictures, importing one from Figma, making or
changing its components: read `references/design-system.md` and follow its steps. A screen that
needs something the system lacks says so, and the system is changed by that job, not by the
screen. A project with no design system yet (a theme that declares nothing) gets one before the
first node: the character settled, then `references/design-system/foundations.md` in that
character, a loaded face and real scales, written down with it in DESIGN.md.[with the editor's tools:  A
component written into the code is placed once the user runs Sync, in either job. Do not ask them
to run it, and do not wait: draw what the job asks for now, with the components the system has
and, where one is missing, its parts, and say in your last message what Sync will bring in. | without: ]

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
| An attached picture to make it from | `references/picture.md` |
| Keyboard, screen reader, contrast, targets | `references/accessibility.md` |
