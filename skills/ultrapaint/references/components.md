# Components

How to find what a component of the design system takes, and the anatomy of the controls screens
most often get wrong.

## Look before you use it

Read the component in its documentation, its source or the list of components you were given:
its props, its variants, its sizes and its slots. Start from its example and replace every
placeholder with real content. Its size comes from outside: the room its parent gives it, its size
prop. When no variant says what the screen needs, take another component or ask the user.

## Buttons

- The primary pairs with a quieter partner of the same height: the secondary (a light grey fill),
  the outline (a hairline border) or a text link with a chevron. A second action is never a second
  colour.
- A filter button is its word and, once set, its value ("Status: Open"); no icon in front.
- Previous, Today and Next are one button group with shared borders, not three buttons.
- A helper action over a column ("Disable all") is a muted link, underlined.

## Fields

- Whatever a field holds, it is the system's field: its icon in the field's icon slot, its chips
  the field's own, its action in its end slot. Text in a box of your own reads as typed; an icon
  laid over a field drifts off its line.
- Only what the user types into gets a field's box. A value the user reads is text.
- Search is a field with its magnifier and a placeholder wherever there is room; an icon button
  that opens one is for a toolbar too narrow for the field. Where search is the page's task (a
  help centre, a job board, a marketplace), the field is the hero.

## Selects and menus

- A quiet select in a row or a sentence ("Can view") has no fill and no fixed width either: it
  sizes to its text. In a form it takes the field's box.
- A badge that only shows a value never opens a menu: no chevron on it.

## Switches and checkboxes

A switch row's description, when it needs one, is one muted line under its label. An unchecked
box has a light border; the checked box carries the weight.

## Badges

- A status or plan badge ("Popular", "High risk") sits in its card's top-right corner, opposite
  the title. On a public page a badge on an image ("New") takes one corner, the same on every tile.
- A card carries one badge. A recommended plan is marked once: a tab on its top edge, or the only
  filled button; a border, a tab and a colour together say it three times.
- A count beside a navigation item sits quiet at the row's right end: a plain muted number, or the
  system's small grey count badge; never an outlined or coloured pill.

## Tabs and segmented controls

- Tabs switch the views of one thing: an underline under the current tab, a segmented track with
  a raised chip, or plain text with a fill on the current one.
- The modes of one dialog or panel are a segmented control across its full width.

## Choice cards

For a few options that each need a line of description (a plan, a role, a template): one card
per option, its name in the label style and its line muted. The selected card takes a `2px`
accent border and a filled check in its top-right corner; an unselected card keeps an empty circle
in the same spot. The fill stays as it is: a tint, coloured text, a border and a check together
mark one thing four times.

## Details and events

A short list of details reads inline, a muted label and its value after it ("Phone (629)
555-0123"); columns are for many rows scanned down. Events in time are a timeline, points on a
vertical line, not rows split by dividers.

## New pieces are named

What the system truly lacks is built from its tokens and named for what it is ("Plan card"). Tell
the user it is new: it needs making as a component (`references/system/components.md`).

## Check

| You see | Fix |
| --- | --- |
| An icon or chips laid over a field | The field's own icon slot and chips |
| A value the user only reads, in a field's box | Text |
| An icon button for search where the field fits | The search field |
| Prev, Today and Next as three buttons | One button group |
| An icon inside a filter button | The word, and its value once set |
| A chevron on a badge that only shows a value | No chevron |
| A navigation count as an outlined or coloured pill | A muted number or the small grey count badge |
| A plan or choice marked by tint, border and colour at once | One mark: the `2px` border and its check, or the tab |
| A secondary action in a second colour | The secondary, outline or a text link |
