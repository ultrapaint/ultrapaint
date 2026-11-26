# ADR 0152: A token is read where the code declares it, `@theme` or a plain root block

Status: accepted, 2026-11-26. Amends 0024 (tokens are the style system's to read and write);
follows 0028 (the code follows the design on export).

## Context

ADR 0024 has the Tailwind v4 adapter read a token as a variable of an `@theme` block. Many
stylesheets declare their colours and sizes in a plain `:root` block instead:
`:root { --color-panel: #f5f5f5; }`. The reader used such a variable only to resolve an alias,
never as a token. Sync then reported `color-panel` as not declared by the code, the Implement
task listed it as "code (not declared)", and an export added a second declaration in `@theme`.
Tailwind writes `@theme` into its `theme` layer, so the unlayered `:root` declaration still won
and the app kept the old value. Agents who hit this dropped the design's value and stopped
using the export (UP-237).

## Decision

- **A token is a variable with a token's name in `@theme` or in an unconditional root block.**
  A token's name is one `nameOfVariable` gives that has a kind in the token table (`--color-*`,
  `--radius-*`, `--text-*`, …). `--primary` and `--header-height` are still no tokens. A root
  block is one whose selector list has `:root`, `html` or `:host` among its selectors, a
  `:not(…)` aside (`:root, [data-theme="light"]`, `:root:not(.dark)`; not `:root .card`), or a
  theme's block (`.dark`, `html[data-theme="…"]`, `@media (prefers-color-scheme: dark)` on its
  own; `body.dark` too), inside a `@layer` or not. A selector with a descendant (`.dark .card`)
  holds for part of the page, and gives no theme its value.
- **A root block under `@media`, `@supports` or `@container` makes no token**, and gives no
  value to one. Its value holds only under that condition, so reading it as the token's value
  would make a phone override the base value. How conditional blocks are told apart for the
  tokens `@theme` declares is UP-236's.
- **A token needs a value in the default theme.** A token's name declared only in `.dark` is
  no token: a theme's value with no base value has nothing to be compared with.
- **Such a token is marked `variableOnly`** (`SourceToken`, and `TokenDiff` in Sync's
  comparison). Tailwind makes no utility class of it. The Implement and Sync tasks say so on the
  token's line, and the code rules have the agent write its variable (`bg-(--color-panel)`).
- **Declared in both `@theme` and a root block, the root value is read and written**, because it
  wins in the app: Tailwind writes `@theme` into its `theme` layer, and the unlayered root
  declaration overrides it, over an alias `@theme` gives the token too
  (`--color-panel: var(--panel)`). Under `@theme inline` the utilities take the `@theme` value
  itself, so that one is read and written, alias followed as before. Either way the reading adds a
  line to its notes naming the token, both files and which value is the token's. Sync's
  comparison and `/init`'s scan show those notes, and `handoff` "export" repeats them for the
  tokens it brings over. One rule picks the declaration for the reader and the writer alike
  (`holderOf`).
- **The export writes the value where the code declares it** (0024), and adds to `@theme` only
  a token the code declares nowhere. It never moves a root token into `@theme`: that move is a
  refactor of the developer's stylesheet, which the code rules leave to the developer.

The reading keeps what UP-236's writer needs: `Reading.plain` holds the variables of the
unconditional root and theme blocks by theme, which a variable-only token's `var()`s are followed
through and a theme's value is added to, beside `scoped`, which still holds every root-scoped
block, conditional ones included.

## Consequences

- A project that declares its tokens in `:root` reads, compares and exports them as one using
  `@theme` does, and `/init`'s first design system includes them.
- shadcn's arrangement reads and writes as before: its `:root` variables (`--primary`, `--radius`)
  have no token's name.
- A helper variable with a token's name becomes a token: `:root { --shadow-color: … }` is a
  shadow token holding a colour, as it would already be in `@theme`. Nothing checks a token's
  value against its kind.
