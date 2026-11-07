# Navigation, menus and pickers

The anatomy of a sidebar, a top bar, a command menu (⌘K), a dropdown or account menu, a mega
menu, an editor's toolbar, a calendar and a date picker.

## Sidebar

- A row: the icon at the system's size, the small step, the label in the control style. Row
  height by the character's density: `32–36px` technical, `40–48px` warm and open. Padding
  `16px`; items `4px` apart; groups `24px` apart, by space or one divider.
- The current row's fill is neutral and rounded, inset from the panel's edges, the label's
  weight unchanged; a solid fill only where the system's selected style is solid.
- Children indent to the parent's label text and carry no icon; a thin vertical guide may join
  them. The parent shows a chevron that turns when open.
- A group label is small and muted, sentence case or tracked uppercase, never bold, with space
  above it; a collapse control or menu may sit at its right.
- A count sits at the row's right end: a plain muted figure or the system's small grey count
  badge; never outlined or coloured.
- An external link ends in an arrow-out icon.
- Pinned to the bottom: Support and Settings, then the account row: avatar, the name over a
  muted email, a chevron or menu at the right. A dismissible upgrade or storage card above it
  only when the product sells one.
- Two tiers: an icon rail (`48–80px`) beside a labelled panel (`280–300px`); the collapsed rail's
  icons take tooltips.
- Themes (light, grey, dark) keep the geometry and change only the surface and selected tokens;
  a dark sidebar is raised by a lighter surface, not a shadow. The sidebar takes the page's or a
  neighbouring surface, never a flood of the brand colour.

## Top bar

- The title, then search as a field where there is room (an icon button only in a bar too
  narrow for it), then the icon buttons and the avatar on one gap and one centre line.
- Where search is the screen's main task (a help centre, a marketplace), the field is the hero.

## Command menu

- Search is a borderless band at the top: the magnifier, text a step larger than the rows, the
  shortcut's keycap at the right; a full-width hairline under it.
- Rows are one line: an icon, the label, the shortcut right-aligned in keycaps; a chord reads
  "⌘K → P". Recent and suggested items lead before anything is typed.
- Group labels small and muted; a second group may have only its divider.
- The hovered or keyboard-active row takes a rounded neutral fill inset from the panel's edges,
  moved without a fade.
- The footer is a keyboard legend: a keycap, then a muted verb ("↵ open", "↑↓ navigate", "esc
  close"). A long list fades at its bottom edge instead of ending hard.
- No results: centred, the query quoted in one muted line, one secondary "Clear search".
- Padding `16px`; rows `8px` within a group, groups `24px`. Labels `12px`, rows `14px`.

## Dropdown and account menus

- A row's kebab opens icon-and-label items; the destructive item comes last, below a divider, in
  the destructive text colour.
- An account menu opens with a header row (avatar, the name over a muted email); accounts follow
  as radio rows, the current one checked; then actions, each an icon and a label ("Profile" with
  the muted @handle); Sign out last. "Sign out of all accounts" is its own full-width outline
  button below.

## Mega menu

- Each item: a line icon or none, the title in the control style, two lines of muted
  description indented under the title, not under the icon. Hover fills the whole item as a
  rounded block.
- Column labels `12px`, uppercase, tracked, muted. A side column on a muted fill may hold one
  promotion or a short list of links, ending in a full-width outline button.
- The open trigger's chevron turns up. A "New" or "Hiring" mark after a title is the neutral
  Badge.

## Editor toolbar

- Selects first (style, font, size), then groups of icon buttons split by short vertical rules.
  Each tooltip names the action and its shortcut ("Bold ⌘B"). Selecting text raises a floating
  toolbar against the selection. Dense toolbars sit tighter than the borderless gap as long as
  each button keeps its own target.

## Calendar

- Header: a date tile (the month abbreviated over the day), the title, the range muted; then,
  right, Previous, Today and Next as one button group with shared borders, a view select, and
  "Add event".
- Events take their category's hue for tint, border and text together, one hue per category,
  apart from the accent. The title left and truncated, the time right. A day cell shows three
  events, then a muted "2 more".
- The selected day is a solid foreground fill; today a neutral circle; days outside the month
  muted. The current time is a thin line across the day in one hue kept for it, its time in the
  gutter.
- Spacing: `6px` within a group, `24px` between, padding `24px`.

## Date picker

- Presets ("Last 7 days", "This quarter") in a side column; the month grid; a footer repeating
  the range in two fields joined by "–", with Cancel and Apply at the right.

## Check

| You see | Fix |
| --- | --- |
| The current row's fill edge to edge | A neutral rounded fill, inset |
| Icons on child rows | The label alone, indented to the parent's text |
| A bold group label | Small and muted, space above |
| A sidebar flooded with the brand colour | The page's or a neighbouring surface |
| A tile around every mega-menu icon | A plain line icon, or none |
| Previous, Today and Next as three separate buttons | One button group |
