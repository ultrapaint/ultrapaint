# ADR 0117: The editor's mono is for blocks of code alone

Status: accepted, 2026-11-23. Amends 0070 (what Geist Mono is for) and 0108 (what stays in it).

## Context

0070 set the editor's values, tokens and code in Geist Mono, and 0108 took paths, URLs and file
names out of it. The mono still stood out all over the editor: a token's name and value on its
board, in the inspector's fields and in the Sync, an element's tag on a comment, a breakpoint's
name, a slot's name, a version, a commit's version, a slash command in the composer's menu, the
backticked words in an agent's message, a command or a package in a sentence, the guidelines'
editor. The person asked for it gone from every part. The design skill says the same of any
interface since g95 (ADR 0082): the mono is for code, and ids, times, figures, labels, tabs,
buttons, captions and cells stay in the sans.

## Decision

- **Geist Mono (`font-code`) sets a block of code's lines and nothing else**: the Code tab's code,
  a diff (Changes, a tool call's edit, an implementation's changes), a terminal's or a tool's
  output, a log (the opening splash), a code block in a message, a command in its box to copy
  (Settings' agents, Save the configuration), a tool's input in a permission question.
- **Everything else is in Figtree**, by the token its place already has: a token's name and value
  on a board, in a field or in a row; a tag, a slot's or a breakpoint's name; a version; a slash
  command in its menu; an option's description, a class too (`OptionSelect` loses its `code`
  flag); the guidelines' editor; an error's message. A word that was marked as code in a
  sentence (a backticked token in a problem, a command, a package, an environment variable) is
  the sentence's token in the foreground, as a path in a sentence is (0108); backticked words in
  an agent's message keep their faint fill.
- A `code`, `kbd`, `samp` or `pre` element takes the face around it: the browser's own mono
  never shows. `typography.test.ts` keeps `font-code` to the files that draw a block of code.

## Consequences

- A token reads in the face of the words around it; its name is told apart by its place (a
  row's name, a board's label), not its face.
- A class in a menu (`max-md:hidden`) reads as words; the menu's label says what it does.
- Adding the mono to a new place is a change to the test's list, made on purpose.
