/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const states = {
  name: "states",
  text: `# States

A screen is not one picture. Show the states it will actually be in, and design each of them,
not only the one where everything is loaded and tidy.

- Every screen with data has an empty state: what the user sees before there is anything, with
  a sentence on what will be here and one action that gets them started. Design it, do not
  leave a blank.
- Loading is a state too. When a screen waits, keep its layout and say what it waits for:
  skeletons in the shape of what is coming for a page, a spinner in the control for an action.
  Do not redesign the screen around a spinner.
- Errors sit where they happened: a field's under the field, a section's in the section, the
  page's at the top. The rest of the screen stays usable.
- A list or table shows enough rows to look like data, and not so many that the screen is
  nothing but the table. Show what a full one does too: it scrolls, pages or truncates.
- Controls have their states: default, hover, pressed, focused, selected, disabled. A disabled
  control says why when it is not obvious, and is rare: prefer letting the user try and
  explaining what is missing.
- Success is quiet: the change shows where it was made, with a short confirmation for what is
  not visible. A toast is for what happened elsewhere or can be undone.
- Destructive actions ask before they act, or let the user undo after. The confirmation names
  what will be lost: "Delete 3 invoices?", not "Are you sure?".
`,
} as const;
