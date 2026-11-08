# Toasts, notifications, chat and files

The anatomy of a toast, a notification panel, an activity feed, an AI chat panel and a file
manager.

Open with it, before the first element: `references/states.md`, `references/iconography.md`,
`references/motion.md`.

## Toast

- A toast reports what happened somewhere the user is not looking, or offers the undo of what
  they just did. A change made in view shows where it was made, with no toast.
- Anatomy: a leading icon or file thumbnail in its own column; a semibold title and a muted
  description at the same size; the actions as text under them, on the text column: "Dismiss"
  muted first, then the positive action brighter ("Undo", "View file").
- One way to close it: the close X at the top right, or "Dismiss"; not both.
- It sits at the bottom right, on the overlay level, often inverted (a near-black surface in
  the light theme). An undo stays until it is dismissed or acted on.

## Notification panel

- A row: a `40px` avatar in a fixed left gutter; the first line a sentence, the actor and the
  object semibold, the verb regular and muted ("**Ana Ruiz** commented on **Q3 plan**"); under
  it a muted line, "2 min ago · Design".
- Attachments, quoted comments and Accept or Decline buttons indent to the text column, not to
  the avatar.
- Unread is a small dot at the row's end, not a row fill.
- Tabs ("All", "Mentions") are a segmented control under the title, a count on the active tab.
  The footer: Close at the left, "Mark all as read" at the right.

## Activity feed

- Events in time are a timeline: small dots on one vertical line, each event's sentence beside
  its dot, the time muted; not rows split by dividers.

## AI chat panel

- The two speakers differ by fill and offset, never by hue: one side bare or bordered on the
  panel's surface, the other on a muted fill and set in from its side.
- A message's actions (copy, retry) are a small row of icon buttons, each with its tooltip: in
  view under the latest answer, raised on hover or focus under the earlier ones.
- The composer is a bordered box: the field, then a strip under it with the model or mode select
  at the left (its text and a chevron), attach and send at the right.
- When the assistant asks before acting, two buttons of equal width (Cancel, then the action
  named) or two text buttons, inside its message.

## File manager

- Quick-create cards across the top (new document, upload, folder): an icon tile at the top
  left, a + at the top right, the label at the bottom left.
- A file row: the type's icon tile, the name in the label style, then size and type muted,
  split by a thin vertical rule. Pinned files are cards of the same anatomy.

## Check

| You see | Fix |
| --- | --- |
| A toast for a change the user can see happen | No toast; the change in place |
| A close X and "Dismiss" on one toast | One of them |
| An undo toast that leaves before the user can act | It stays until dismissed |
| Toast actions as filled buttons at the right | Text actions under the text, Dismiss first |
| Unread rows in a tinted fill | A dot at the row's end |
| Attachments or buttons aligned under the avatar | Indented to the text column |
| Chat speakers in two hues, or the user's messages in the accent | Fill and offset, neutral |
