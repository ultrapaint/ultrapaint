# Tables

The anatomy of a table or a list of records: its container, toolbar, header, rows, selection,
pagination and empty states.

Open with it, before the first element: `references/components.md`, `references/iconography.md`,
`references/states.md`.

## Table or not

- Columns are for many rows scanned down. A few facts about one record read inline instead, a
  muted label and its value after it ("Phone (629) 555-0123").
- Below the breakpoint where the columns stop fitting, each row becomes a list item: the
  identity line, then two or three of its facts, its menu at the right.

## Container

- The table sits in one bordered surface, or bare on the page when it is the page. Its outer
  corners take the surface's radius; rows and cells stay square. A table already on a surface
  gets no second frame.
- The title carries the count beside it as muted text ("Customers 1,284"), or no count at all.
- Spacing: padding `24px`; text within a group `8px` apart; groups (toolbar, table, pagination)
  `24px` apart.

## Toolbar

- Above the table, on one row: a segmented control of saved views at the left ("All, Active,
  Archived"); a search field and a Filters button at the right; the table's actions in the
  page header above. A reading table may have no primary.
- Search is a field with its magnifier and a placeholder; it needs no label.
- Filters is its word and, when set, its value ("Status: Paid"), no icon. One action clears
  every filter. A long set of filters sits in a sunken well that opens under the toolbar.

## Header row

- Small labels (`12px`, the small style), muted, on a faint band or bare above a hairline. No
  icons; a sort chevron beside each sortable column's label.

## Rows

- The first cell is the identity: an avatar or logo (initials when there is no photo, never an
  empty disc), the name in the label style over one muted line (an email, a domain). Other cells
  are one line: values in the foreground, metadata (dates, ids, owners) muted.
- People take avatars, records their logo or type icon; no other icons in cells.
- The row ends in its main action in view (a "View" link) or a kebab opening an icon-and-label
  menu; edit and delete live in that menu.
- Height by the character's density: single-line rows `32–40px` in a technical tool, more in a
  warmer one; a row with a two-line identity runs up to about `72px`. Text `14px`.
- Hover and selection fill the whole row; a hairline or a guide stops at the fill.

## Selection

- A checkbox column at the left. With a selection, the header becomes "3 selected" with the bulk
  actions beside it, or a floating dark bar at the bottom holds them ("3 selected · Export ·
  Archive · Delete"), the destructive one last.
- Escape or one "Clear" ends the selection.

## Pagination and the edge

- Enough varied rows to read as data, then the edge: it scrolls, pages, or offers "Show 12 more".
- Pages: "Page 1 of 10" with Previous and Next; numbered pages with an ellipsis for long sets; a
  rows-per-page select only where people change it.

## Empty

- A search or filter that finds nothing, centred: a picture of what it would have found (an
  avatar fan, a few logos) only where the character allows imagery, a title ("No customers
  found"), one muted line quoting the query, and one secondary "Clear search" or "Clear
  filters". The recovery is that button only, not again as a link in the line.

## Check

| You see | Fix |
| --- | --- |
| A grey frame around an inset white table | One edge: the surface or the table's border |
| Icons in the header row | Labels only, a sort chevron where it sorts |
| An icon in the Filters button | The word, and its value when set |
| "Showing page 1 of 10" beside the numbered pages, "Search results (4)" over four rows | Remove it |
| Every cell in one muted size and weight | The identity in the label style, values foreground |
| Two-line rows in a dense technical table | One line, `32–40px` |
