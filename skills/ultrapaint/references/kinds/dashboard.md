# Dashboards

The anatomy of a dashboard: its header and time range, the figure cards, the sections and the
charts.

## Header

- A breadcrumb above the title when the dashboard sits under something; the actions on the
  title's row, right-aligned, no rule under either.
- The title is modest (the screen is about several things), and may carry its context muted at
  the same size: "Analytics example.com".
- The time range sits at the header's right, the one control that changes every figure below: a
  segmented control, or text toggles ("12m 30d 7d 24h") with the active one in the foreground.

## Figure cards

- A row of cards of equal width, each: a small muted label (it may itself be a select, its text
  and a chevron), the figure, and the change badge on the figure's baseline at the card's right.
  A sparkline or the card's menu may follow; nothing else.
- The figure is the screen's one display size, about `36px`, regular or medium. Its unit is
  small and muted on its baseline ("€12.4k", "84 ms").
- A screen built around one figure (a balance, revenue) gives that figure the display size,
  about `48px`, and the other figures the title style.
- When a card drives the chart below, the chosen card takes the system's selected style (a
  neutral fill or an underline), and the chart's title names what it shows.

## Sections

- Each widget sits in its own bordered card on the page, or no cards at all: a section title
  over a hairline, the content under it. One screen picks one of the two.
- A section title may carry its one figure inline, muted after it: "Site traffic +104%",
  "Customers 68".
- A card's title row: the title at the left, its range or menu at the right; never a tinted
  title strip over an inset panel.
- Spacing: padding `24px`, `12px` within a group, `32px` between groups.

## Charts

- One series compared with its past is one colour: the current period solid, the previous
  dashed or dotted, a forecast hatched.
- The tooltip is dark or the overlay surface, rounded, rows of label and value, the value in
  the foreground.

## Check

| You see | Fix |
| --- | --- |
| A title of `36px` over a dashboard | The title style; the size goes to the figure |
| Two display sizes (a `48px` balance and `36px` cards) | One display size; the rest the title style |
| A tinted title strip over an inset white panel | One surface, the title inside it |
| The previous period in a second hue | The same hue, dashed |
