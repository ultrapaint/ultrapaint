---
colors:
  background: oklch(1 0 0)
  foreground: oklch(0.147 0.004 49.25)
  muted-foreground: oklch(0.553 0.013 58.071)
  primary: oklch(0.56 0.18 255)
  primary-foreground: oklch(0.985 0.001 106.423)
  brand: oklch(0.56 0.18 255)
  brand-foreground: oklch(0.985 0.001 106.423)
  secondary: oklch(0.97 0.001 106.424)
  secondary-foreground: oklch(0.216 0.006 56.043)
  muted: oklch(0.97 0.001 106.424)
  accent: oklch(0.97 0.001 106.424)
  accent-foreground: oklch(0.216 0.006 56.043)
  card: oklch(1 0 0)
  card-foreground: oklch(0.147 0.004 49.25)
  popover: oklch(1 0 0)
  popover-foreground: oklch(0.147 0.004 49.25)
  border: oklch(0.923 0.003 48.717)
  input: oklch(0.923 0.003 48.717)
  ring: oklch(0.709 0.01 56.259)
  destructive: oklch(0.577 0.245 27.325)
  success: oklch(0.6 0.16 150)
  warning: oklch(0.62 0.15 70)
  canvas: oklch(0.965 0.002 75)
  canvas-grid: oklch(0.147 0.004 49.25 / 9%)
  board: oklch(0.95 0.012 255)
  selection: "#4f8cff"
  component: "#8b5cf6"
  agent: "#ec4899"
  agent-foreground: "#ffffff"
  sidebar: oklch(0.985 0.001 106.423)
  sidebar-foreground: oklch(0.147 0.004 49.25)
  rail: oklch(0.95 0.003 75)
  sidebar-primary: oklch(0.56 0.18 255)
  sidebar-primary-foreground: oklch(0.985 0.001 106.423)
  sidebar-accent: oklch(0.97 0.001 106.424)
  sidebar-accent-foreground: oklch(0.216 0.006 56.043)
  sidebar-border: oklch(0.923 0.003 48.717)
  sidebar-ring: oklch(0.709 0.01 56.259)
  chart-1: oklch(0.869 0.005 56.366)
  chart-2: oklch(0.553 0.013 58.071)
  chart-3: oklch(0.444 0.011 73.639)
  chart-4: oklch(0.374 0.01 67.558)
  chart-5: oklch(0.268 0.007 34.298)
typography:
  heading-small:
    fontFamily: Figtree Variable
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.25rem
  heading-xsmall:
    fontFamily: Figtree Variable
    fontSize: 0.875rem
    fontWeight: 600
    lineHeight: 1.25rem
  body:
    fontFamily: Figtree Variable
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
  label:
    fontFamily: Figtree Variable
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.25rem
  rail:
    fontFamily: Figtree Variable
    fontSize: 0.625rem
    fontWeight: 500
    lineHeight: 0.75rem
  code:
    fontFamily: SF Mono
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
rounded:
  xs: 0.125rem
  sm: 0.375rem
  md: 0.5rem
  lg: 0.625rem
  xl: 0.875rem
  2xl: 1.125rem
spacing:
  base: 0.25rem
---

## Overview

Ultrapaint is a design tool that lives in a code repository: designers and developers draw pages on a canvas, with the product's own components and tokens, beside the coding agents that read and write them. The editor is a workspace people sit in for hours, so it is compact and quiet, and the design on the canvas is always the loudest thing on the screen.

Its character is technical, made a little warmer and friendlier: Figma's or pen.dev's floating panels over a canvas, drawn on warm paper-grey rather than cold zinc, in a geometric face with round forms, with the brand's blue as the one colour. Tone is terse and plain: the noun and the number, no exclamation marks.

Dials: warm-neutral temperature, compact density, soft shape (8px controls, 14px cards), restrained accent (the brand blue).

## Colors

- {colors.color-primary} is the brand blue: the one primary button of a view, a checked switch or checkbox. {colors.color-brand} is the same blue, for what is current: the prototype's mode, the active breakpoint, an unread mark.
- Neutrals are warm stone greys. {colors.color-foreground} for text that is read; {colors.color-muted-foreground} for hints, metadata, placeholders and idle icons.
- A selected or highlighted row is a neutral fill ({colors.color-accent}, {colors.color-sidebar-accent}), never a wash of blue.
- {colors.color-destructive} for deleting and errors only, drawn as a 10% tint with red text. {colors.color-success} and {colors.color-warning} are status dots and icons, never fills.
- The canvas has its own colours: {colors.color-canvas} under the pages, {colors.color-board} for the Design system and Library boards. A selection is {colors.color-selection} on a plain element, {colors.color-component} on a component instance, {colors.color-agent} on an agent's work. These three are the canvas's language and never appear in panels' chrome.
- Dark mode keeps the same roles: the stone greys darken, borders become 10% white, and the blue lifts a step.

## Typography

One face for the interface: Figtree, a geometric sans with round bowls and open shapes, loaded with `@fontsource-variable/figtree`; the system mono beside it for code, ids and token values. The user asked for rounded but geometric: round forms, not rounded terminals. The editor reads at 14px throughout; the stock Tailwind sizes are left for Streamdown and for designs drawn on the canvas, never the editor's own text.

- {typography.heading-small}: 16px semibold, the title of a dialog, a page or a card.
- {typography.heading-xsmall}: 14px semibold, a panel's or a section's title, a field label.
- {typography.body}: 14px regular, everything else.
- {typography.label}: 14px medium, control text and names in a list.
- {typography.rail}: 10px medium, the rail's labels only.
- {typography.code}: 14px mono.

A box too short for a 20px line takes `leading-4`, never a smaller role.

## Layout

A 4px spacing scale. Controls are 28px high (24px small, 32px large), rows 28–32px, panel padding 8–12px, gaps 4–8px inside a group and 16px between groups. The editor fills the window: a canvas with floating cards over it, set apart from each other and from the window's edge. Dialogs are 28rem wide by default (24rem small, 32rem large).

## Elevation & Depth

The canvas is the ground. The rail, side panels, toolbar and title card float over it as cards of their own: {colors.color-sidebar} with a hairline border and `shadow-floating`. Menus, popovers and tooltips sit above them with `shadow-md`; dialogs with `shadow-lg` over a dimmed backdrop. Inside a panel, depth is a sunken {colors.color-muted} well or a hairline, never a shadow.

## Shapes

{rounded.md} (8px) for controls: buttons, fields, rows, menu items. {rounded.sm} for the smallest buttons and keys. {rounded.lg} (10px) for menus, popovers and inner cards. {rounded.xl} (14px) for the floating cards and dialogs. Badges and avatars are fully round. Borders are 1px hairlines.

## Components

- Button: `primary` for the one action a view is for, `secondary` for a quieter filled action, `outline` beside a primary, `ghost` for toolbar and panel actions (the most common), `destructive` for delete, apart from the others. `icon` buttons always carry a tooltip.
- Badge: neutral; a status is a coloured dot inside it.
- Input, Select, Textarea, Checkbox, Switch: in fields with a semibold label above or beside them.
- Menu for actions on a thing; Popover for a few fields edited in place, reusing the inspector's fields; Dialog for a task that needs the whole attention; Toast for a result that needs no answer.
- Tabs and the segmented control switch views inside a panel.

## Do's and Don'ts

- Do keep every text in one of the text styles; never a stock size (`text-xs`, `text-[11px]`).
- Do keep panels quieter than the design: no colour in the chrome but the blue for what is current.
- Do use a neutral fill for selection in lists and menus.
- Do reuse the inspector's fields in a plain popover rather than drawing a bespoke diagram.
- Don't put a shadow on anything inside a panel; shadows are for what floats.
- Don't use the canvas's selection, component or agent colours outside the canvas.
- Don't add icons to every row or label; icons where they speed recognition.
- Don't use a second primary button in one view.
