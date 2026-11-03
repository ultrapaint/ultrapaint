---
colors:
  background: oklch(0.175 0.004 70)
  foreground: oklch(0.965 0.003 80)
  muted-foreground: oklch(0.67 0.008 75)
  primary: oklch(0.56 0.2 263)
  primary-foreground: oklch(0.99 0 0)
  brand: oklch(0.56 0.2 263)
  brand-foreground: oklch(0.99 0 0)
  secondary: oklch(0.28 0.004 70)
  secondary-foreground: oklch(0.965 0.003 80)
  muted: oklch(0.255 0.004 70)
  accent: oklch(0.285 0.004 70)
  accent-foreground: oklch(0.965 0.003 80)
  card: oklch(0.235 0.004 70)
  popover: oklch(0.245 0.005 70)
  border: oklch(1 0 0 / 8%)
  input: oklch(1 0 0 / 13%)
  ring: oklch(0.66 0.17 263)
  destructive: oklch(0.68 0.18 25)
  success: oklch(0.74 0.15 155)
  warning: oklch(0.82 0.14 78)
  canvas: oklch(0.165 0.004 70)
  board: oklch(0.185 0.018 262)
  sidebar: oklch(0.222 0.004 70)
  rail: oklch(0.176 0.004 70)
  selection: "#4f8cff"
  component: "#8b5cf6"
  agent: "#ec4899"
typography:
  heading-small:
    fontFamily: Onest Variable
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.5rem
    letterSpacing: -0.01em
  heading-xsmall:
    fontFamily: Onest Variable
    fontSize: 0.875rem
    fontWeight: 600
    lineHeight: 1.25rem
  body:
    fontFamily: Onest Variable
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
  label:
    fontFamily: Onest Variable
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.25rem
  small:
    fontFamily: Onest Variable
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.125rem
  caption:
    fontFamily: Onest Variable
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1rem
  code:
    fontFamily: Geist Mono Variable
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.25rem
rounded:
  sm: 0.25rem
  md: 0.375rem
  lg: 0.625rem
  xl: 0.75rem
  2xl: 1rem
spacing:
  base: 0.25rem
---

## Overview

Ultrapaint is a design tool that lives in a code repository: designers and developers draw pages
on a canvas with their product's own components and tokens, beside the coding agents that read and
write them. People sit in it for hours, so it is compact and quiet, and the design on the canvas is
always the loudest thing on the screen.

The feel is a drafting table under a lamp: warm graphite instruments around paper-white work. It is
technical and exact, made a little warmer by its neutrals and by a face with round, geometric forms.
One colour, ultramarine (the pigment in the name), marks what the user acts on: the primary action,
a checked control, the tool in hand, the focus ring. References: Figma UI3's floating panels and
bottom toolbar, Linear's restraint.

Dials: warm temperature, compact density, soft shape (6px controls, 12px cards), restrained accent,
geometric type voice, no imagery, terse tone.

The editor has two themes on one set of roles, light (warm paper) and dark (warm graphite), and
follows the system's unless the person picks one in Settings › Editor.

## Navigation

- **Left card**: the project (mark, name over branch), search (⌘K) and the panel's toggle; the
  canvas shown, a filled select of its own with 8px under it; then an icon rail beside the panel. Rail: Agents, Layers (Foundations in the design
  system), Components; at its foot Changes, Settings and who the user is. A rail icon is named by its
  tooltip and by the panel's own title. Put away, the card is the project's row alone.
- **Place switch**, top centre: Canvas · Design system · Prototype, the three places of the editor.
- **Tools**, bottom centre, one row: Insert, the tools, undo and redo, the zoom.
- **Element toolbar**, over the tools while something is selected: its design-system selects and
  its menu, in one place at every zoom. On the canvas the selection keeps only its tag, its name
  and the agent's ✦, never wider than the element.
- **Right card**: Design · Code · Comments as a segmented control, and the panel's toggle.

## Colors

- Neutrals are warm graphite (hue 70, chroma under 0.006). In dark a surface higher up is lighter:
  canvas, panel, card, popover. In light the panels are warm white over a paper-grey canvas.
- Two text colours: {colors.foreground} for what is read first (names, values, titles, labels of
  actions); {colors.muted-foreground} for what qualifies it (sizes, routes, times, hints,
  descriptions, placeholders, idle icons). Foreground 15:1, muted about 5:1 on a panel.
- {colors.primary} (ultramarine) is the one colour of the chrome: the one primary button of a view,
  a checked switch or checkbox, the active tool, the focus ring. Never on headings, icons or rows.
- Selected and hovered rows, the active tab, the current rail item: a neutral fill
  ({colors.accent}), never a wash of blue.
- {colors.destructive} for deleting and errors: red text on a 10–15% tint. {colors.success} and
  {colors.warning} are status dots and icons beside a word, never fills.
- The canvas's own language: {colors.selection} on a plain element, {colors.component} on a
  component instance, {colors.agent} on an agent's work and an agent working (the rail's dot). These
  stay off the panels' chrome otherwise.

## Typography

Onest, loaded with `@fontsource-variable/onest`; Geist Mono for values, tokens, routes in code and
code. Roles are `font-<role>` utilities; the editor never uses a stock size.

- `font-heading-small` 16/24 semibold: a dialog's or a page's title.
- `font-heading-xsmall` 14/20 semibold: a panel's, a section's or a card's title, a field label.
- `font-body` 14/20: everything read.
- `font-label` 14/20 medium: control text (buttons, tabs, menu items), names in a list.
- `font-small` 13/18: what qualifies its neighbour: a size, a route, a time, a hint, a description,
  an inspector row's label, a menu's group label.
- `font-caption` 12/16 medium: keys, counts, badges, avatars' initials only.
- `font-code` 13/20 mono.

A panel's section title is `font-heading-xsmall` in the foreground; the rows under it carry their
label in `font-small` muted and their value in the foreground. A description sits in muted, never
in the foreground.

## Layout

A 4px scale. Controls 28px (24 small, 32 large), list rows 28px, menu rows 28px, panel headers 44px.
Panel padding 8px around rows, 12px for text; 4px between rows of a group, 16px between groups. The
editor fills the window: the canvas with three floating cards over it, 8px from the window's edge
and from each other. Dialogs are 28rem wide by default, 20px padding.

## Elevation & Depth

The canvas is the ground. The left card, the right card, the place switch and the tools float over
it: {colors.sidebar}, a hairline border, `shadow-floating`. The left card has two levels: its frame
(the project, the canvas picker, the rail) on {colors.rail}, a step down, and the panel raised
inside it on {colors.sidebar}, flush with the card's edges, a hairline and a 10px corner only where
it meets the frame. The
rail's current place is raised the same way, so it reads as the panel it opens. Menus, popovers and tooltips sit above
with `shadow-overlay` and a hairline ring; dialogs with `shadow-overlay` over a 30% (light) or 60%
(dark) black backdrop, no blur. Inside a card, depth is a filled field or a hairline, never a shadow.

## Shapes

{rounded.md} (6px) for controls: buttons, fields, rows, menu items, tabs. {rounded.sm} for keys and
checkboxes. {rounded.lg} (10px) for menus, popovers and inner cards. {rounded.xl} (12px) for the
floating cards. {rounded.2xl} (16px) for dialogs. Avatars, badges and switches are fully round.

## Components

- Button: `default` (ultramarine) for the one action a view is for; `secondary` for a quieter filled
  action; `outline` beside a primary; `ghost` for toolbar and panel actions (the most common);
  `destructive` for delete, apart from the others. Icon buttons carry a tooltip.
- Fields are filled ({colors.muted}), borderless at rest; a hairline on hover; the ring on focus.
- Tabs: a segmented control (muted track, raised chip) to switch views inside a card.
- Badge: neutral; a status is a coloured dot inside it.
- Menu for actions on a thing; Popover for a few fields edited in place, reusing the inspector's
  fields; Dialog for a task that needs the whole attention; Toast for a result elsewhere or an undo.
- Tooltips: a short name and the keys, nothing more. No arrows.
- Empty states: a muted icon, a one-line title, one muted sentence, one action.

## Motion

Hover and press change colour in 100–150ms. Menus and popovers enter from 95% scale and transparent
in 150ms on `--ease-enter`; dialogs in 150–200ms. Nothing the keyboard triggers animates. Under
reduced motion only fades remain.

## Content

Terse and plain: the noun and the number. Sentence case everywhere ("Design system", "New chat").
Buttons start with a verb. Tooltips name the thing and its keys. Empty states say what will be there
and offer one action. Errors say what happened and what to do. No exclamation marks.

## Do's and Don'ts

- Do keep every text in a role; never `text-xs` or `text-[11px]`.
- Do keep the chrome quieter than the design: no colour but ultramarine for what is acted on.
- Do use a neutral fill for selection in lists, menus, rails and tabs.
- Do reuse the inspector's fields in a plain popover rather than drawing a bespoke diagram.
- Don't put a shadow on anything inside a card.
- Don't use the canvas's selection, component or agent colours on the chrome.
- Don't add icons to every row or label, or a description that repeats its heading.
- Don't use a second primary button in one view.
