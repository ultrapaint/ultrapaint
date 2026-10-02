/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const content = {
  name: "content",
  text: `# Content

A design is judged with the words it will hold. Write real copy, at realistic lengths, in the
product's voice, and say each thing the way the product always says it.

- No lorem ipsum, no "Title", no "Lorem". Names, amounts, dates and messages look like the
  product's own: plausible, varied, in the product's language.
- Show the awkward lengths: a long name next to a short one, an amount with many digits, a
  paragraph that wraps twice. A design that only holds tidy data breaks in production.
- Labels are nouns, buttons are verbs, and both are short. "Invoices", "Send invoice", not
  "Manage your invoices here" and "Click to send". Sentence case, not Title Case.
- One voice, a tone for the moment. The voice is DESIGN.md's; the tone is calm in an error,
  brief in a confirmation, warm in an empty state. Never blame the user, never joke about a
  failure.
- A message says what happened and what to do next, in one or two sentences, near the thing it
  is about. "Couldn't save the invoice. Check your connection and try again." Not "Error 500".
- Inclusive by default: address the user as "you", write people's names as they gave them,
  avoid gendered defaults and idioms that need a culture to decode, and never let an image or a
  colour carry what the words do not say.
- Dates, times, numbers and currency are formatted for the reader, the same way everywhere:
  "2 Oct 2026" or "2 minutes ago", never an ISO string; thousands separated; the currency with
  the amount. Relative times for what just happened, absolute ones for what is planned.
- The same thing has the same name on every screen. If the product calls it a workspace, it is
  never also a project.
`,
} as const;
