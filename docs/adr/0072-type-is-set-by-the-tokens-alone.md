# ADR 0072: Type is set by the type tokens alone

Status: accepted, 2026-11-09. Amends 0071 (emphasis as a weight after the token, `font-code`).

## Context

0071 gave the editor Atlassian's type tokens, but Tailwind's own type utilities stayed beside
them: `text-sm`, `font-medium`, `leading-5`, `tracking-wide`, `font-mono`. A class list could
still set a size, weight or line height a token did not, and emphasis was written as a weight
after a token (`font-body font-medium`), which the editor's `cn` had to know to drop. The person
asked for the stock utilities to go, so that type can only be set with the `font-*` tokens, and
for weights to live only in tokens.

## Decision

- **The theme clears Tailwind's type**: `--text-*`, `--font-*`, `--font-weight-*`, `--leading-*`
  and `--tracking-*` are `initial` in `styles.css`, so their utilities draw nothing. The faces
  are custom properties outside the theme (`--face-heading`, `--face-body`, `--face-code`),
  read only by the tokens and the page's own font.
- **Emphasis is a token**: `font-body-medium` (14/20 at 500, what was `font-body font-medium`),
  `font-body-semibold` (14/20 at 600, bold in running text, a table's header) and
  `font-body-small-medium` (12/16 at 500). There is no weight utility.
- **`font-code` is 12/20**, so a block of lines needs no `leading-5`; a value on a row of its own
  takes the row's height.
- What the theme cannot clear, a line height from the spacing scale (`leading-5`) and arbitrary
  values (`text-[13px]`, `font-[500]`), `typography.test.ts` keeps out of the editor's sources,
  with the old names; `lib/cn.test.ts` keeps the editor's `cn` in step with the tokens
  `styles.css` defines.
- A field's `Label` is `font-heading-xsmall`, the size `DESIGN.md` gives a field's label; the
  project switcher's name is too, as the title bar's.
- Streamdown's renderers carry Tailwind classes of their own, which now draw nothing: the
  markdown's overrides set its headings, code, tables and `strong` (`font-body-semibold`) with
  tokens, and a link inherits its sentence's.

## Consequences

- A new emphasis is a new token in `styles.css`, `cn.ts`'s list and `DESIGN.md`, never a class
  beside a token.
- The designs drawn on the canvas are untouched: they draw in shadow roots with their own sheets.
