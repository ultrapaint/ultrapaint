/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const content = {
  name: "content",
  text: `# Content and states

A design is judged with the content it will hold. Write real words, at realistic lengths, and
show the states the screen will actually be in.

- No lorem ipsum, no "Title", no "Lorem". Names, amounts, dates and messages look like the
  product's own: plausible, varied, in the product's language and tone.
- Show the awkward lengths: a long name next to a short one, an amount with many digits, a
  paragraph that wraps twice. A design that only holds tidy data breaks in production.
- A list or table shows enough rows to look like data, and not so many that the screen is
  nothing but the table.
- Every screen with data has an empty state: what the user sees before there is anything, with
  one action that gets them started. Design it, do not leave a blank.
- Errors and warnings say what happened and what to do next, in one or two sentences, near the
  thing that failed.
- Loading is a state too. When a screen waits, say what it waits for; do not redesign it around
  a spinner.
- Labels are nouns, buttons are verbs, and both are short. "Invoices", "Send invoice", not
  "Manage your invoices here" and "Click to send".
`,
} as const;
