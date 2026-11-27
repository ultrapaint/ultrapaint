# ADR 0158: An export keeps the stylesheet's form

Status: accepted, 2026-11-27. Amends 0152 (conditional blocks); follows 0024 (tokens are read
and written where the style system declares them) and 0028 (the code follows the design on
export).

## Context

An export of the design's tokens damaged a client's stylesheets (UP-236). About 25 colour
tokens declared as aliases of a grey (`--color-border: var(--color-gray-200)`) got the grey's
value in place of the alias. A type size's phone override in a media query was read as its base
value and overwritten with the desktop one. A `@theme` block was appended per token the reading
had missed. Two animation tokens read from a minified package came out as
`accordion-down .2sease-out0s`, their spaces gone, and were written back over the package's.
Agents stopped trusting the export and wrote values by hand.

## Decision

- **A block under `@media`, `@supports` or `@container` is that condition's override**, for a
  token `@theme` declares as for one a root block does (0152): it gives no token its base value
  or a theme's value, no `var()` is followed through it, and an export never writes it.
  `@media (prefers-color-scheme: dark)` alone stays the dark theme's block. The reading has one
  map of the unconditional blocks' variables by theme (`plain`); `scoped`, which held the
  conditional ones too, is gone.
- **Declarations are read in the order their rules apply**: what a stylesheet imports before
  the stylesheet itself, as CSS puts an imported sheet where its `@import` stands. A project's
  override of a package's token, written after the `@import`, is the token's value, and the one
  an export wrote reads back. The list of files read keeps its order, an entry first.
- **An export writes nothing where the code's value is the design's already**, compared as Sync
  compares (`sameValue`), wherever it is declared: a package's token (`tw-animate-css`) whose
  value is the package's is never written. One that differs is added as the project's own
  override, as any token the project's stylesheets cannot write.
- **An alias stays an alias.** A change to a declaration written `var(--x)` points it at another
  declared variable of the same kind that comes to the new value (a `@theme` token, a root
  variable or one of Tailwind's), the nearest in name to `--x`; with none, the value is written in
  its place.
- **An alias is written through only into the token's own variable**: one no other declaration
  names, named after the token (`--color-primary` and `--primary`) or set again by a theme.
  That is shadcn's arrangement, written as before. A palette step that other tokens share is
  read through and never written: the token's own declaration takes the change.
- **What the code declares nowhere it can write is added together**: one `@theme` block (or one
  theme block) per theme, into the block of that kind the stylesheet already has or appended to
  it, in the writable stylesheet that declares most of the project's tokens, `@theme` or root
  (the first one read when none does). A namespace's reset still puts it after the reset (0024).
- **The writer reports each change** (`TokenWrite`): the token, its theme, the file, the value
  as written before and after, and whether it changes a declaration, adds one, takes one out or
  writes nothing. Nothing is written by the style system, so the same call is the dry run.
  Sync's comparison runs it for the tokens that wait for the code (`TokenDiff.write`), and its
  list before Export says, row by row, the file the value is written in or added to. `handoff`
  "export" answers with every change, file by file, and the tokens it left alone; its
  description and parameters are unchanged. `codeTokens: auto` writes at once, as it says.
- **A value followed through `var()`s keeps its parts apart**: a value put in place of a
  `var()` and the word, number or `var()` right after it get a space between them when the
  stylesheet wrote none (`var(--d,.2s)var(--e,ease-out)` reads `.2s ease-out`), for every reader
  of `resolveVars`.

## Consequences

- An export's diff changes only the values that differ, where they are declared, in the
  stylesheet's form, and lists them.
- Two tokens sharing one root variable (`--color-background` and `--color-surface`, both
  `var(--background)`) each take their own value in their own declaration; the variable keeps
  its. Under `@theme inline`, a token given a value in place of a shared alias no longer follows
  the variable's other themes: Sync shows its theme values to export again.
- Pointing an alias at another variable needs one of the same kind with the same value; a
  palette whose steps have no token's name (`--gray-200`) matches only other variables with no
  token's name.
- A theme's value of a token that shares an alias under `@theme inline` is added to the theme's
  block under the token's own variable, which that token's utilities do not read: the developer
  moves the token out of `inline`, or gives the theme its own variable.
- A token the code declares only under a condition has no base value, so an export adds it to
  `@theme`; the conditional declaration stays the override it was.
- Stylesheets an earlier export damaged are not repaired: Sync still shows what differs, and
  exporting it writes the design's value.
