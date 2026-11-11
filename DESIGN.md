---
colors:
  background: oklch(0.99 0.001 80)
  foreground: oklch(0.21 0.006 60)
  muted-foreground: oklch(0.515 0.01 65)
  primary: oklch(0.53 0.21 263)
  primary-foreground: oklch(0.99 0 0)
  brand: oklch(0.53 0.21 263)
  brand-foreground: oklch(0.99 0 0)
  secondary: oklch(0.945 0.003 80)
  secondary-foreground: oklch(0.21 0.006 60)
  muted: oklch(0.955 0.003 80)
  accent: oklch(0.935 0.004 80)
  accent-foreground: oklch(0.21 0.006 60)
  card: oklch(1 0 0)
  popover: oklch(1 0 0)
  border: oklch(0.21 0.006 60 / 10%)
  input: oklch(0.21 0.006 60 / 16%)
  ring: oklch(0.53 0.21 263)
  destructive: oklch(0.55 0.21 27)
  success: oklch(0.6 0.15 155)
  warning: oklch(0.7 0.15 70)
  canvas: oklch(0.945 0.004 80)
  board: oklch(0.95 0.012 262)
  sidebar: oklch(0.995 0.001 80)
  rail: oklch(0.955 0.004 80)
  selection: "#3d7bff"
  component: "#8b5cf6"
  agent: "#ec4899"
typography:
  heading-xxlarge:
    fontFamily: Cal Sans
    fontSize: 2rem
    fontWeight: 400
    lineHeight: 2.25rem
  heading-xlarge:
    fontFamily: Cal Sans
    fontSize: 1.75rem
    fontWeight: 400
    lineHeight: 2rem
  heading-large:
    fontFamily: Cal Sans
    fontSize: 1.5rem
    fontWeight: 400
    lineHeight: 1.75rem
  heading-medium:
    fontFamily: Cal Sans
    fontSize: 1.25rem
    fontWeight: 400
    lineHeight: 1.5rem
    letterSpacing: 0.01em
  heading-small:
    fontFamily: Cal Sans
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.25rem
    letterSpacing: 0.02em
  heading-xsmall:
    fontFamily: Cal Sans
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
    letterSpacing: 0.02em
  heading-xxsmall:
    fontFamily: Cal Sans
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1rem
    letterSpacing: 0.02em
  body-large:
    fontFamily: Figtree Variable
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5rem
  body:
    fontFamily: Figtree Variable
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
  body-medium:
    fontFamily: Figtree Variable
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.25rem
  body-semibold:
    fontFamily: Figtree Variable
    fontSize: 0.875rem
    fontWeight: 600
    lineHeight: 1.25rem
  body-small:
    fontFamily: Figtree Variable
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1rem
  body-small-medium:
    fontFamily: Figtree Variable
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1rem
  code:
    fontFamily: Geist Mono Variable
    fontSize: 0.75rem
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
follows the system's unless the person picks one in Settings › Preferences.

## Navigation

- **Left card**: the project (mark, name over branch), search (⌘K) and the panel's toggle; the
  canvas shown, a filled select of its own with 8px under it; then an icon rail beside the panel.
  Rail: Agents, Layers (Foundations in the design system), Components, Comments (on the canvas);
  at its foot Changes, Settings and who the user is. A rail icon is named by its
  tooltip and by the panel's own title. Put away, the card is the project's row alone.
- **Place switch**, top centre: Canvas · Design system · Prototype, the three places of the editor.
- **Tools**, bottom centre of the window, one row: Insert, the tools, undo and redo, the zoom.
- **Element toolbar**, over the tools while something is selected: its design-system selects and
  its menu, in one place at every zoom. On the canvas the selection keeps only its tag, its name
  and the agent's ✦, never wider than the element.
- **Right card**: Design · Code as a segmented control, and the panel's toggle; drawn only while
  something is selected (a layer, a page, several frames, or a board's pick), gone otherwise.

## Colors

- Neutrals are warm graphite (hue 70, chroma under 0.006). In dark a surface higher up is lighter:
  canvas, panel, card, popover. In light the panels are warm white over a paper-grey canvas.
- Two text colours: {colors.foreground} for what is read first (names, values, titles, labels of
  actions); {colors.muted-foreground} for what qualifies it (sizes, routes, times, hints,
  descriptions, placeholders, idle icons).
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

Atlassian's semantic type tokens: seven headings and three bodies, each a `font-<token>` utility
carrying the face, size, line height, weight and tracking, and the only way the editor sets type:
Tailwind's sizes, weights, line heights, letter spacing and faces are cleared from its theme.
Headings are Cal Sans (`@fontsource/cal-sans`), bodies Figtree (`@fontsource-variable/figtree`),
values, tokens, routes in code and code Geist Mono. Cal Sans has one weight, its 400, never made
bold, and is spaced for display sizes, so the headings to 20px open it.

- `font-heading-xxlarge` 32/36, `-xlarge` 28/32, `-large` 24/28, `-medium` 20/24: for a page
  of the editor's own that needs them; its panels and dialogs use the two below.
- `font-heading-small` 16/20: a dialog's or a page's title.
- `font-heading-xsmall` 14/20: a panel's, a section's or a card's title, a field's label.
- `font-heading-xxsmall` 12/16.
- `font-body-large` 16/24: a page's lead, where there is one.
- `font-body` 14/20: everything read.
- `font-body-medium` 14/20 at 500: control text (buttons, tabs, menu items), names in a list.
- `font-body-semibold` 14/20 at 600: bold in running text, a table's header.
- `font-body-small` 12/16: what qualifies its neighbour: a size, a route, a time, a hint, a
  description, an inspector row's label, a menu's group label.
- `font-body-small-medium` 12/16 at 500: keys, counts, badges, avatars' initials.
- `font-code` 12/20 mono: a value on its row, or a block of lines.

Emphasis is a token of its own, a body at Atlassian's `font.weight.medium` or `semibold`, never a
weight added to a token. Class lists are merged with the editor's `cn`
(`apps/web/src/lib/cn.ts`), where a later token replaces an earlier one.

A panel's section title is `font-heading-xsmall` in the foreground; the rows under it carry their
label in `font-body-small` muted and their value in the foreground. A group's name over a list of
names (Components' App components, Design system's Foundations) is `font-body-small` muted, quieter
than the names it groups.

## Layout

A 4px scale. Controls 28px (24 small, 32 large), list rows 28px, menu rows 28px, panel headers 44px.
Panel padding 8px around rows, 16px for text: a panel's title starts on its rows' text edge. A
section's title stands 24px further from the group above it than rows do from each other. A divider
in a bar is a short rule centred on the bar's line. The editor fills the window: the canvas with
three floating cards over it, 8px from the window's edge and from each other. Dialogs are 28rem
wide by default, 20px padding. A list's last row keeps the panel's padding under it.

## Elevation & Depth

The canvas is the ground. The left card, the right card, the place switch and the tools float over
it: {colors.sidebar}, a hairline border, `shadow-floating`. The left card has two levels: its frame
(the project, the canvas picker, the rail) on {colors.rail}, a step down, and the panel raised
inside it on {colors.sidebar}, flush with the card's edges, a hairline and a 10px corner only where
it meets the frame. The
rail's current place is raised the same way, so it reads as the panel it opens. Menus, popovers and tooltips sit above
with `shadow-overlay` and a hairline ring; dialogs with `shadow-overlay` over a 30% (light) or 60%
(dark) black backdrop, no blur. Inside a card, depth is a filled field or a hairline, never a shadow.
The settings dialog has the left card's frame: its sections and page on {colors.rail}, each group
raised on {colors.card} with its fill as its only edge. On a raised surface in dark, a field fills
with {colors.input} at 50%.

## Shapes

{rounded.md} (6px) for controls: buttons, fields, rows, menu items, tabs. {rounded.sm} for keys and
checkboxes. {rounded.lg} (10px) for menus, popovers and inner cards. {rounded.xl} (12px) for the
floating cards. {rounded.2xl} (16px) for dialogs. Avatars, badges and switches are fully round.

## Components

- Button: `default` (ultramarine) for the one action a view is for; `secondary` for a quieter filled
  action; `outline` beside a primary; `ghost` for toolbar and panel actions (the most common);
  `destructive` for delete, apart from the others.
- Fields are filled ({colors.muted}), borderless at rest; a hairline on hover; the ring on focus.
- Tabs: a segmented control (muted track, raised chip) to switch views inside a card.
- Menu for actions on a thing; Popover for a few fields edited in place, reusing the inspector's
  fields; Dialog for a task that needs the whole attention; Toast for a result elsewhere or an undo.
- Tooltips: a short name and the keys. One that has more to say than a name (why a control is
  off, where a value comes from, what a status means) says it in a sentence or two, the
  name first when there is one. No arrows. Undo and Redo with nothing to take back say why in
  theirs when the history was dropped ("Nothing to undo: … changed outside the editor").
- An empty panel's state is centred in it, a muted icon above its text and buttons.
- A hint about the selection ("Inserts into …") sits at the panel's foot.
- A row's actions are all in its ⋯ menu.
- What can be undone runs at once with Undo in its toast; no confirm. A busy button shows a
  spinner and its verb ("Committing…").
- List rows sit 2px apart, so their fills never touch; a row's keyboard focus is the 2px ring
  around the whole row. Checkboxes and off switches are edged in {colors.muted-foreground}; a
  checkbox's focus is a 2px ring 2px off it.
- A diff's added lines are the foreground on {colors.accent}; removed ones {colors.destructive} on
  its 10% tint; context muted.
- A select in a settings row is its value and a chevron, filled only on hover; a field there is
  13rem wide, on the row's right edge.
- A panel action with nothing to act on is not drawn, rather than drawn disabled.
- An error tied to a row sits under it in full, across the row, on a 10% red box; a file's schema
  error names the place in the file in mono, never the validator's text. A notice takes the same
  place, muted, with a warning icon. A status that blocks the action (a conflict) is in the
  foreground with a warning dot.
- Skeleton rows are the foreground at 10%; a retry is named Try again.
- A group's title is `font-heading-xsmall` in the foreground, its note under the title, at most
  28rem wide.
- A section that applies at once has Done in its footer in place of Cancel and Save, and says
  nothing of applying; the footer names only any other section's unsaved edits. The settings dialog opens with focus on the dialog;
  the section shown is raised like the rail's current place.

## Motion

Hover and press change colour in 100–150ms. Menus and popovers enter from 95% scale and transparent
in 150ms on `--ease-enter`; dialogs in 150–200ms.

## Content

Terse and plain: the noun and the number ("Design system", "New chat", "3 pages"). No
exclamation marks.

## Do's and Don'ts

- Do keep every text in a role; never `text-xs` or `text-[11px]`.
- Do keep the chrome quieter than the design: no colour but ultramarine for what is acted on.
- Do use a neutral fill for selection in lists, menus, rails and tabs.
- Do reuse the inspector's fields in a plain popover rather than drawing a bespoke diagram.
- Don't put a shadow on anything inside a card.
- Don't use the canvas's selection, component or agent colours on the chrome.
- Don't draw a tree's guide lines across a row's fill.
- Don't use the browser's `title` for a tooltip: the system Tooltip.
