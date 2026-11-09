# ADR 0071: The editor's type is Atlassian's semantic tokens

Status: accepted, 2026-11-09. Amends 0058 (seven type roles at four sizes) and 0070 (the
heading roles' tracking). Emphasis and `font-code` are amended by 0072.

## Context

0058 gave the editor seven type roles of its own: two headings, `font-body`, `font-label` (body
at medium), `font-small` (13/18), `font-caption` (12/16 medium) and `font-code` (13/20). Each
carried its weight, so emphasis was a role of its own, and 13px sat between steps no other
system has. The person asked for Atlassian's semantic type tokens instead: a set of headings and
a set of bodies, ready to use.

Atlassian's tokens, as `@atlaskit/tokens` 20.11 defines them: `font.heading.xxlarge` to
`xxsmall` (32/36, 28/32, 24/28, 20/24, 16/20, 14/20, 12/16, bold), `font.body.large`, `font.body`
and `font.body.small` (16/24, 14/20, 12/16, regular), `font.weight.regular`, `medium`,
`semibold` and `bold` (400, 500, 600, 653), and `font.code`.

## Decision

- **The type tokens** are Atlassian's, one `font-<token>` utility each in `styles.css`:
  `font-heading-xxlarge` … `font-heading-xxsmall` and `font-body-large`, `font-body`,
  `font-body-small`, at Atlassian's sizes and line heights. The faces stay those of 0070: Cal Sans
  for headings, at its one weight and never synthesised bold (`font-synthesis: none`), opened by
  0.02em to 16px and 0.01em at 20; Figtree for bodies.
- **Emphasis is a weight after the token**, as Atlassian's: `font-label` became `font-body
  font-medium`, `font-caption` `font-body-small font-medium`. Tailwind's weights carry
  Atlassian's names and values: `font-regular` 400 beside `font-normal`, and `font-bold` 653.
- **13px is gone**: `font-small` became `font-body-small`, 12/16. The person chose Atlassian's
  scale over keeping 13px under its name, so every line that qualifies another is 1px smaller.
- **`font-code`** stays the editor's: Geist Mono at 12/16, the size of the body it sits in most,
  where Atlassian's `font.code` is 0.875em of its surroundings at a line height of 1, which a
  value on a row of its own cannot use. A block of several lines takes `leading-5`.
- **The editor's `cn`** (`apps/web/src/lib/cn.ts`) is the `cn` package's merge told the tokens:
  a later token drops an earlier weight, line height or tracking, so a component's `font-body
  font-medium` given `font-heading-xsmall` is drawn as the heading. A test keeps the package's own
  `cn` and the old role names out of the editor's sources.

## Consequences

- Secondary text, a quarter of the editor's text, is 12px; rows that set `leading-4` for it now
  set what the token does.
- Five of the seven headings and `font-body-large` have no use yet; they are there to be used
  rather than to grow a size of a screen's own.
- `DESIGN.md` lists the tokens and the weights; a correction to them is the product's choice, a
  value there (0065).
