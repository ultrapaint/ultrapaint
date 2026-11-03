# States

A screen is not one picture. Show the states it will actually be in, and design each of them,
not only the one where everything is loaded and tidy.

Draw each state as its own frame beside the loaded one, a copy of the page or the region named
for its state. What the screen holds decides which; a static page has none to draw.

## The states follow from the content

| When the screen | Draw |
| --- | --- |
| Shows text it does not author | Empty, one word, typical, several sentences, one unbreakable string |
| Lists items | None, one, the realistic count, ten times it |
| Waits on the network | Loading, and the error |
| Takes input | Errors on the fields, submitting |
| Changes or deletes something | Success, and the confirmation or the undo |

## Empty states start something

Before there is anything, the region keeps its place and says what will be there, with one
action that fills it. The words are content's.

Suggestions in an empty state (a chat's starters, a search's recent queries) are three or four,
chosen for the moment. More belong in search or a command.

## Loading keeps the layout

For a page or a region, skeletons in the shape of what is coming. For an action, a spinner
inside the control, which keeps its label and its width. The screen is the same screen, waiting.

## Errors sit where they happened

A field's error under the field, a section's in the section, the page's at the top. The rest of
the screen stays usable.

## Lists show their edge

Enough varied rows to look like data, then what happens past them: it scrolls, pages or offers
"Show 12 more".

## Controls show their states

Default, hover, pressed, focused, selected and disabled, through the component's own props where
it has them. Disabled is rare and says why; letting the user try and saying what is missing is
usually better.

## Success is quiet

The change shows where it was made. A toast is for what happened elsewhere, or for an undo.

## Destructive actions confirm or undo

Ask first, naming what will be lost, or act at once and offer an undo that stays until
dismissed.

## Before you finish

| You see | Fix |
| --- | --- |
| Only the loaded state of a screen with data | Draw empty, loading and error |
| Ten identical rows | Varied, realistic rows |
| A spinner in place of the whole page | Skeletons in the page's layout |
| A banner at the top for one field's error | The error under the field |
| A disabled submit with no reason given | Enabled; say what is missing on submit |
| A name that only ever fits | One that wraps or truncates, drawn |
| More than four suggestions in an empty state | Three or four for the moment; the rest in search or a command |
