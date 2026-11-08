# Settings

The anatomy of a settings page and its relatives: the row, saving, sub-pages, billing,
integrations, a profile and a team page.

Open with it, before the first element: `references/components.md`, `references/typography.md`,
`references/layout.md`.

## Settings are rows

- A section is one surface (or the bare page) holding a stack of rows split by hairlines; never
  a card per row. The section's name sits outside its surface, above it or in a left column.
- A row: the label, and at most one muted line under it, in the left third (about `270–300px`);
  the control at the right, capped at about `512px`. A switch takes the row's right edge.
- A row that only shows a stored value reads label | the value as text | an "Edit" link or a
  small outline button at the far right; it becomes a field in place when edited, the field
  taking the text's style and position so nothing moves.
- A helper line carries a rule or live data ("Used on 3 invoices"), or a "Learn more" link where
  the question comes; a row whose label says it all has none.
- A helper action over a column of rows ("Disable all") is a muted underlined link.
- On a phone the two sides stack: label, line, then the control full width.
- Spacing: padding `24px`, `12px` within a group, sections `32px` apart. Rows and their lines
  in the body and small styles; uppercase group labels, where the system has them, at `12px`.

## Saving

- A page of independent settings (switches, selects) saves each change on its own, with
  "Saved" beside the control that changed.
- A group edited as one (an address, a profile's fields) ends in Save and Cancel, right-aligned
  at the end of its surface.
- One page saves one of the two ways.

## Sub-pages

- Sub-pages are tabs under the page title: the system's tabs, one style across the product.
- A setting that needs verifying (a new email) opens in place under its row as a bordered
  panel: one line saying where the code went, the code cells, Verify and a resend link.

## Billing

- The plan or usage is a large figure with a small muted unit on its baseline ("€40 per month",
  "60.2 GB of 200 GB"), regular weight; the price stays beside the button that changes it.
- Plan cards: name, what it includes, price, then one full-width button. The current plan's
  button reads "Current plan", outline or disabled; only the plan you can move to gets the
  primary. A chosen plan takes a `2px` accent border and a filled check, its fill unchanged; a
  recommended one is marked once, by its surface or a tab.
- A card's header row holds its title, one status badge and its menu at the far right.
- The history title carries its count as muted text ("Billing history 44") when the table shows
  no count of its own.
- Payment methods, like plans and integrations, are records the user picks among: cards, not
  rows.

## Integrations

- A grid of cards of one height: a logo tile and the name, a switch at the top right; a one- or
  two-line description clamped so the cards match; a footer row with one text link
  ("Configure", "View connections").

## Profile

- A cover band with the avatar overlapping its lower edge; the name in the title style, one
  muted line under it.
- Stats are a small muted label over a large figure, cells split by thin vertical rules; use
  them only when the figures are the headline. A few contact details read inline, label and
  value.
- Beside the photo, "Remove" muted, before "Upload" in its stronger variant.
- On a technical product, no gradients, seals or holographic badges on the cover.

## Team page

- A grid of portraits, every one in one treatment (all colour, all greyscale, or one duotone),
  one crop, one size; no card around each. Name in the label style, role muted.

## Check

| You see | Fix |
| --- | --- |
| A card around each settings row | One surface; rows split by hairlines |
| A stored value drawn as a disabled field | The value as text, an Edit action at the row's end |
| An inline edit that shifts the text or its weight | The field takes the text's style and place |
| Save buttons on a page whose switches already save | One way of saving per page |
| An icon tile in the gutter beside a section title | Remove it |
| Every plan card with a primary button | The primary on the plan you can move to only |
