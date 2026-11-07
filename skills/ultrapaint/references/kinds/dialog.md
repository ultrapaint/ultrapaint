# Dialogs

The anatomy of a dialog and a sheet: header, body, footer, and the recipes for a confirmation, a
share or invite dialog and an upload. A dialog that holds a form, choice cards or a code also
takes its fields from `references/kinds/form.md`.

## The frame

- A dialog is centred and dims the page; a sheet slides from the edge it is attached to and
  dims it the same. Both sit on the overlay surface, a step above what they cover, in both
  themes: a dialog's pane never darker than the page behind it.
- Padding, header, body and footer: the system's dialog padding when it names one, else `24px`
  on every side. Groups in the body `24px` apart, items within a group `12px`.
- Escape, the close X and Cancel all leave, and Cancel leaves no trace.

## Header

- Title, then at most one muted line, then the close X at the top right: a bare X, an icon
  button with its tooltip. The title is about three words; the line stays only when it says
  what the title cannot (who will see it, what it costs).
- Left-aligned by default. A header that leads with an illustration or an avatar group centres,
  and so does a short permission or confirmation dialog; the body below keeps its own alignment.
- Modes of one dialog ("Link", "Invite", "Embed") are a segmented control across its full width,
  under the title.

## Body

- Field groups are separated by space; the dialog's own edges are the only box around them.
- Where the dialog does several jobs, each job's surface is a fill a step off the dialog's
  (muted on white, a lighter step in dark), not the dialog's own colour with a border. Surfaces
  sit about `8px` apart: tighter than their `16px` padding, while the text in one is still
  2× further from the text in the next than from its own.
- What informs takes a fill (a link box, a preview well, a permission tray); what the user picks
  or repeats takes a card (an option, a plan, a download row).
- Help that most users skip folds into one collapsed row on a muted fill instead of lengthening
  the dialog.
- A field that only applies under one option is indented under that option's label, shown when
  it is chosen.

## Footer

- **Split** (the default): the actions that finish the job at the right, emphasis rising
  rightward (ghost or outline, then the primary); the left holds one utility or escape (Help,
  Copy link, Reset to default, the step dots of a short flow, or Cancel alone).
- **Equal pair**: a confirmation, sign-in or onboarding dialog sets Cancel (outline) and its
  action as two buttons of equal width filling the footer.
- On a phone the buttons stack full width, the primary first.
- Set the footer off with a full-width hairline only when the body scrolls under it; otherwise
  the padding is the edge.

## Confirmation

- The title is the question naming what is lost ("Delete 3 invoices?"); one line says what goes
  with it ("Their payments stay in Reports."); the buttons answer it alone: Cancel and "Delete
  invoices" in the destructive variant, as the equal pair.

## Share and invite

- The invite field and its Invite button share one row at equal height; a role select at the
  field's end is its text and a chevron.
- A member row: avatar, the name over a muted email, a small neutral badge after the name
  ("You", "Pending"), the role at the row's right as quiet text and a chevron. A pending person
  takes an initials avatar.
- The link field holds its copy action at its end. The footer: Copy link (or Embed) at the left,
  one "Done" at the right.
- Link, people and access are three jobs: three quiet surfaces, no heading over any.

## Sheet

- The header holds the title and its close X; the body scrolls; the footer stays pinned under a
  full-width hairline: a tertiary link at the left, Cancel and Save at the right.

## Upload

- The drop area is a dashed or muted surface with one action ("Choose file") and what it takes
  ("PDF or PNG, up to 10 MB"). Each file then becomes a row: its type's icon, the name, its size
  and a remove action.

## Check

| You see | Fix |
| --- | --- |
| A bordered icon tile, a texture or a 3D object heading a working dialog | Remove it; the title leads |
| The dialog's pane darker than the dimmed page, or its two panes one tone | The overlay surface, a step above; the panes a step apart |
| Two finishing actions at the left of a split footer | One utility left; finishing actions right |
| A job's surface in the dialog's own white with a border | A fill a step off the dialog |
| A dialog's padding off what DESIGN.md gives dialogs | The system's padding on every side |
| A hairline above a footer that nothing scrolls under | Remove it |
