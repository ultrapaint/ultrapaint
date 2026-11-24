# ADR 0140: Every question an agent asks is one question, and takes an answer typed in the composer

Status: accepted, 2026-11-24. Amends 0116 (the person's own words), 0022 (the form's fields).

## Context

0116 had `ask_user` take typing on every question, and left an MCP server's own form to the
fields it asks for. Neither agent asks with `ask_user` alone: each has a question tool of its own,
which its ACP adapter puts to the editor as a form, with the answer of the person's own in a text
field of its own name beside the options' field. Claude's AskUserQuestion (claude-agent-acp 0.95)
is `question_<n>` and `question_<n>_custom`, titled Other, nothing required; Codex's
request_user_input (codex-acp 2.2) is `<id>` with a "None of the above" option it adds, and
`<id>_note`, marked `_meta.codex.role: "user_note"`. The editor paired only its own
`<id>:other`, so it asked the text field as a second question ("1 of 2", then Other) and the
first took no typing: "Pick an option, or press its number".

T3 Code takes a typed answer on every question unless the question forbids it
(`allowCustomAnswer: false`), and folds a choice's free-text companion field into the choice.

## Decision

- A form's text field paired with a field of options is the answer of the person's own to that
  question, never a question of its own: `<id>:other` (the editor's), `<id>_custom` (Claude),
  `<id>_note` or a `_meta.codex` user note (Codex), `<id>__other` (as T3 Code reads). Codex's
  added "None of the above" is not shown; a typed answer sends it with the note, as Codex's own
  client does. Two text fields stay questions of their own, as T3 Code keeps them: one the form
  requires, and one beside a number, which has no words to take.
- Every question takes typing in the composer. A choice with no paired field, and a yes or no,
  takes the typed text as its own value; a choice the form requires, whose paired field has no
  option that says "read the text", takes it in both fields. `allowOther` now defaults to true,
  and nothing the editor asks sets it to `false`.
- A typed answer stands instead of the options picked, as in T3 Code: an option and a note are
  not sent together.
- A digit in an empty answer field still picks its option; typing on after it makes the digit
  the start of an answer of one's own, so "2 columns" can be typed.
- `ask_user` pairs an `<id>:other` field with every question's options.

## Consequences

- An MCP server's own form may get back a value outside its options, or words for a yes or no;
  the agent reads them as the person's words, as it reads an answer to `ask_user`. A server that
  checks its answers against the schema refuses them, which the agent then says.
- A free-text field under a name not listed above is still a question of its own: no rule tells
  it from a real question. A new adapter's pairing name needs a line in `elicitation.ts`; the
  regression tests there hold the two built-in agents' forms, written from their adapters'
  sources (claude-agent-acp 0.95, codex-acp 2.2).
- A third-party form's optional `<id>_note` beside a field of options reads as that question's
  answer of one's own, not as a note of its own.
