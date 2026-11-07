# States

How to draw each state beyond the loaded one: where it goes, what it keeps, how it ends.

## Draw each beside the loaded one

Each state is its own copy of the screen or of the region that changes, beside the loaded one and
named for its state ("Invoices, empty"). A static page has none to draw.

## Empty

The region keeps its place and size and says what will be there, with the one action that fills
it (its words: `references/words/interface.md`). Suggestions past four belong in search or a
command.

## Loading

- A page or a region: skeletons in the shape of what is coming, at the layout's own sizes.
- An action: a spinner inside its control, which keeps its label and its width. The screen is the
  same screen, waiting.

## Errors

A section's error sits in the section, the page's at its top; the rest of the screen stays
usable.

## Lists show their edge

Enough rows, varied as real data is, to look like data, then what happens past them: it scrolls,
it pages, or it offers "Show 12 more".

## Controls show their states

Default, hover, pressed, focused, selected and disabled, through the component's own props where
it has them. Disabled is rare and says why; letting the user try and saying what is missing is
usually better.

## Success is quiet

The change shows where it was made. A toast is for what happened elsewhere, or for an undo; an
undo stays until it is dismissed.

## Check

| You see | Fix |
| --- | --- |
| Ten identical rows | Varied, realistic rows, and the list's edge |
| A button that loses its label or changes width while it works | A spinner inside it, label and width kept |
| A skeleton in shapes the content does not have | The loaded layout's shapes and sizes |
| An error that blocks the whole screen for one section | The error in its section, the rest usable |
| A disabled control with no reason | Say why, or enable it and say what is missing |
| A toast for a change visible where it was made | The change in place, no toast |
| An undo that times out before it can be read | Until dismissed |
