---
name: content
description: "A design is judged with the words it will hold. Write real copy, at realistic lengths, in the product's voice, and say each thing the way the product always says it. Use when designing or reviewing an interface's content."
---

# Content

A design is judged with the words it will hold. Write real copy, at realistic lengths, in the
product's voice, and say each thing the way the product always says it.

Read the copy the product already has before writing. The voice DESIGN.md's Overview sets is the
voice; plain language bends to it everywhere except errors and destructive moments.

## Real words at real lengths

Names, amounts, dates and messages look like the product's own: plausible, varied, in its
language. Put the awkward lengths beside the tidy ones: a long name next to a short one, an
amount with many digits, a paragraph that wraps twice.

## Nouns label, verbs act

Labels are nouns, buttons start with a verb naming what happens: "Invoices", "Send invoice",
"Save draft". Both are short and in sentence case.

## Confirmations name the consequence

"Delete 3 invoices?" with `Delete invoices` and `Cancel`: the buttons alone answer the question.

## One voice, a tone for the moment

| Moment | Tone |
| --- | --- |
| Success, onboarding, empty states | Warm, may be light |
| Routine actions, settings | Neutral, minimal |
| Errors, destructive confirmations | Calm and plain |
| Data loss, security, money | Serious and explicit |

## Errors say how to fix it

What happened and what to do next, in one or two sentences, next to what it is about. "Couldn't
save the invoice. Check your connection and try again." Hints say what to do: "Use only
letters", not "No numbers or symbols". The user is never to blame.

## Empty states point forward

What this place holds, how to fill it, one action: "No projects yet", "Projects keep your tasks
and files together.", `Create project`. A filtered one names the query and a way out: "No
results for ‘quarterly’. Clear filters".

## Links say where they go

"Read the billing docs", "Learn more about exports": each link makes sense read alone.

## Settings describe the on state

A toggle is labelled for what happens when it is on: "Send read receipts".

## One name per thing

If it is a workspace in the menu, it is a workspace in the toast. A flow keeps one vocabulary:
"Continue" or "Next", and "Done" to finish.

## Speak to the reader

"You", not "the user". No gender by default, no idioms that need a culture to decode, "select"
when both touch and pointer apply.

## Format for the reader

"2 Oct 2026" or "2 minutes ago", thousands separated, the currency with the amount: "€1,240.00".
Relative times for what just happened, absolute ones for what is planned. A placeholder shows an
example of the format, `name@example.com`.

## Before you finish

| You see | Fix |
| --- | --- |
| Lorem ipsum, "Title", "Item 1" | Real copy |
| A legend on a chart, a title over a block its tabs already name | Delete it; shrinking is not enough |
| "vs last year" after a change, "Enabled" beside a switch, "17 rows" under a table, "5 of 5" over a stepper, a title over a toolbar | Remove it: the thing beside it already says so |
| A plain value ("Moderate") turned into a coloured status badge | Plain text, as the brief writes it |
| Title Case On Buttons | Sentence case |
| "Submit", "OK" or "Yes" on a consequential action | Verb and object: "Send invoice" |
| "Are you sure?" | Name what is lost |
| "Something went wrong" | What happened and what to do |
| "Click here" | Name the destination |
| Two names for one thing | The one the product already uses |
| A date as `2026-10-02` | "2 Oct 2026" |
