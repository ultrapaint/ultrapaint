# Copy

Rules for every word a person reads in a product: labels, descriptions, buttons, errors, empty states, banners, hero text. The project's own copy rules — its reader, its protected terms, its languages, how a string reaches the product — are the **Copy standard** setting, and they add to these and win where they differ.

## Write for the reader, not the technician

The reader is the person using the product, as the **Copy standard** describes them. By default they are distracted, they read once, and they did not build the product. Every line is judged by that reader: would they know what it means, and what to do, on one pass?

The **technician** is the failure mode. Technician copy names the mechanism; reader copy names the outcome for the reader. Rewrite any line that describes the system to the reader:

| Technician | Reader |
| --- | --- |
| Manage your availability timeslots | Pick the times that work for you |
| Session token expired | You were signed out. Open your link again to get back in. |
| Username is your unique public identifier | Your username is how friends find you |
| Enable public reservation name visibility | Show guests' names on the shared page |

Three checks catch technician copy:

- **A domain term is a name, not a definition.** The project's glossary defines terms so the people building it agree; it does not license them in copy. Some terms are user-facing, and most internal ones are not. When a glossary term carries a user-facing rendering, use it. When it does not, describe what the reader does or gets.
- **A benefit before a feature.** Hero text, descriptions, banners and field descriptions open with what changes for the reader. The feature name, if it is needed at all, comes second.
- **A verb the reader performs.** "Configure", "manage", "enable", "generate", "validate" describe the system. "Pick", "share", "invite", "play", "show" describe the reader.

## Protected terms and product names

- A **protected term** keeps its exact spelling and capitals, untranslated, everywhere. The **Copy standard** lists them.
- Product names are proper nouns in copy, written the way the brand writes them — never an internal code form.
- Every other glossary term is a plain word in copy. The glossary's capitals do not reach the screen.
- Same term for the same thing everywhere. If it is "Archive" in the menu, it is not "Move to storage" in the toast.

A deliberate brand voice is not a defect. Raise a departure from plain language only when it creates ambiguity, inconsistency, translation risk, or a tone the stakes do not support.

## One voice, tone by stakes

| Context | Tone |
| --- | --- |
| Hero, success, onboarding, empty states, descriptions | Warm, can be light |
| Routine actions, settings, field descriptions | Neutral, minimal |
| Errors, destructive confirmations | Calm, plain, zero playfulness |
| Data loss, security, account deletion | Serious, explicit |

## Speak to "you"

Instructional copy says "you", never "the user", "the guest", "the admin". A description says what the field does for you, not who the field is for.

"We" is for warm, low-stakes copy where the product is talking: a hero, a welcome. In an error it reads as deflection. Prefer "Unable to save" to "We're having trouble saving".

Possessives are rare in labels and headings: "Favorites", not "Your favorites". In a sentence that names the reader's own things — "Your cart is empty" — one reads naturally. One perspective per flow.

## Plain words, short lines

- Choose words a twelve-year-old gets on the first pass. Delete every word that does no work.
- One idea per sentence, under 20 words. A description is one or two sentences; a hero subtitle is one.
- Use everyday contractions: "you're", "it's", "we'll". Spell out "cannot" and "do not" in errors and destructive confirmations, where a misread negative costs the most.
- No idioms, no puns, no humour that will not survive translation. Translations run longer — German and Italian up to 40% over English — so a string that fills its box in English breaks in the longest language the product ships.
- Humour is seasoning: one light touch per surface at most, in the warm tone row only. Never in an error, a confirmation or a notification.
- Exclamation marks are a budget: one per screen, only for a real celebration. None in an error, a setting or a serious moment.
- No unnecessary gender: "Guests can pick a time", not "each guest picks his or her time".
- Match the device: "tap" on touch, "click" with a pointer, "select" when either is possible.
- A number or a name goes in a placeholder, never spliced from fragments. Word order changes per language.

## Buttons start with the verb

A button names the action: "Send", "Save changes", "Create project". Never "OK", "Yes", "Let's go". One to three words, under 20 characters, no punctuation.

A confirmation button repeats the consequence so the dialog is answerable without its body: "Delete this project?" offers `Delete project` and `Cancel`. The body states what cannot be undone, in one line. The title is the question, never "Are you sure?".

A multi-step flow keeps one vocabulary: "Get started" to enter, "Continue" to advance, "Done" to finish. Pick one advance word and keep it.

## Links say where they go

Link text stands alone, because screen readers list links out of context. "Read the billing docs", never "click here". Two "Learn more" on one page collide; suffix each one: "Learn more about invites".

Link straight to a referenced setting. "Notification settings" as a link, not "go to Settings, then Notifications".

## Fields: label, description, example, fix

Each part of a field does one job:

- The **label** names the thing in the reader's words. "Username", "Project name", "Your times".
- The **description** says what it is for and the one rule the reader will hit. It is not the validation policy. "Your username is how friends find you. Letters, numbers, dots and underscores." The rest of the policy lives in the error, when it is needed.
- The **placeholder** is an example of the expected format: `name@example.com`, `alex.smith`. It vanishes on input, so a visible label stays.
- The **error** is an instruction, beside the field that failed, phrased as the fix: "Use at least 3 characters", not "Too short". Positive over negative: "Use only letters", not "No numbers or symbols".

A toggle describes the ON state: "Show guests' names", never "Don't hide names".

## Errors say how to fix it

Structure: what happened, then how to fix it. Add why only when the reader can act on it.

| Weak | Strong |
| --- | --- |
| Oops! Something went wrong. | Unable to save. Refresh the page and try again. |
| Invalid username | Use lowercase letters, numbers, dots or underscores |
| Payment failed | Your bank declined the card. Try another card or contact your bank. |

**Name a cause the reader can act on, and only a true one.** "Check your connection" is right only when the app knows it is offline; a failure the server answered is not a lost network, and the line sends the reader after a cause that is not there.

- A refusal the server names gets its own message, phrased as what happened: "This invitation is no longer open."
- Any other failure names what did not happen and the one fix that works for a stale page: "Could not join. Refresh the page and try again."
- A form, an upload, or any action on a screen that holds an unsaved draft keeps what the reader entered. A reload would throw it away, so its failure says "Try again." instead.
- A failure screen with its own retry button says to try again first, then to refresh: "Try again. If it still does not load, refresh the page."

No blame, no exclamation marks. Words that never appear in an error: "error", "invalid", "failed", "forbidden", "oops", "sorry", "please". Each one either adds nothing or implies a choice the reader does not have. An error that keeps firing is an interaction to redesign, not a sentence to reword.

A success toast is under 30 characters: "Changes saved". An error toast names what did not happen in as few words, and may add the fix as one short sentence. A toast is only for an action with no form or dialog to hold an alert, such as a one-click button, a menu item or a copy; a form or a confirmation dialog shows its failure in its own alert.

## Empty states point forward

An empty state says what this place is, why it is empty, and the one thing to do next:

- Weak: "No results."
- Strong: "No projects yet. A project is where your team keeps its work." with `Create a project`.

The title states what is missing, with "yet". The button matches the title: `Create a project`, not `Get started`. A routine action is not a success to celebrate.

A search or filter empty state names the query and offers an exit: "No results for 'quarterly'. Clear filters". Persistent information never lives in an empty state; it disappears the moment content exists.

## Sentence case

Sentence case for every element type: labels, buttons, headings, menu items. It is calmer, has no per-word rules and localises cleanly. Proper nouns and protected terms keep their capitals.

## Long-form copy: hero, descriptions, banners

Marketing and descriptive copy follows the same reader rule at a larger size:

- The **hero title** is the promise, in the reader's life, in under ten words. The subtitle says how, in one sentence. The button says the first step.
- An **item description** — a product, a plan, a template — opens on what you do with it, with verbs the reader performs. Two sentences. Facts like counts and lengths belong in the card's metadata, not the prose.
- A **feature banner** opens with what the reader can now do, then one sentence of how, then one verb-first button. The feature's internal name is optional.
- A **form intro** says what the form is for and what happens after submit, in one or two sentences.

## Docs for practitioners

A design system or developer documentation page has a different reader: a designer or developer at a desk, looking up a token, a component or a rule, and coming back to it. The technician check inverts there: the word the reader implements is the right word.

- **Name the thing by its system name.** Token names, scales, palettes, states and formats are the copy: `surface-200`, OKLCH, hover, focus-visible.
- **Define, then prescribe.** A section opens with what the thing is, in one sentence, then says when to use it and when not: "Surface 200 is the hover or selected fill. Use it on a panel under the pointer, never as a page background." A fragment ("Dividers.") names without teaching.
- **A rule carries its number.** A contrast rule names the ratio and the standard it meets. A spacing rule names the base unit. A number the reader has to match is prose here, not card metadata.
- **Imperative, not "you".** "Use the muted scale for secondary copy", not "You can use the muted scale".
- Everything else holds: the neutral tone row, plain words, short lines, sentence case.

**Completion criterion:** every line in scope passes the reader check on one read, every button starts with its verb, every error states its fix, every protected term keeps its rendering, and every changed string reaches the product the way the **Copy standard** says.
