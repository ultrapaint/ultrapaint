# ADR 0027: DESIGN.md follows the open standard, at the repository root, kept in step with the code both ways

Status: accepted, 2026-10-15. Amends 0015 (the design system's two files) and 0025 (sync).
Plan: `docs/PLAN-design-md.md`.

## Context

`DESIGN.md` has been free prose in the designs directory since 0015: the agent writes it whole,
nothing reads it but the briefing, and no other tool knows it is there. Meanwhile
[DESIGN.md](https://github.com/google-labs-code/design.md) has become an open format (version
`alpha`) that coding agents and design tools read and write. Stitch exports it, designers write
it by hand, and agents outside the editor look for it at the root of a repository, the way they
look for `AGENTS.md`. A file in the format has two parts:

- **YAML front matter with tokens**: `colors`, `typography` (one entry is a family, a size, a
  weight, a line height and a tracking), `rounded`, `spacing` and `components` (per component a
  background, a text colour, a typography, a radius, a padding, a size), with `{colors.primary}`
  references, plus `name`, `description` and `omitted`. Unknown keys are allowed.
- **A markdown body in `##` sections, in this order:** Overview, Colors, Typography, Layout,
  Elevation & Depth, Shapes, Components, Do's and Don'ts. Unknown sections are kept.

The format's own philosophy fits 0025: the prose is the design, and token values are context
for an agent, not rendering instructions. A file that mirrors the code's values is the format as
intended. `@google/design.md` lints it (broken references, WCAG contrast, section order) and
exports it to Tailwind and DTCG.

## Decision

**`DESIGN.md` is the design system's document, in the open format, at the repository root.** It
is what any agent or person reads to learn the design system, inside the editor or not. A
`DESIGN.md` in the designs directory is still read when there is none at the root. Sync offers to
move it, and the move is one undo step. The constant is `DESIGN_FILE`, and the path is not a
setting.

**The code keeps the values (0025 unchanged), and the front matter mirrors them both ways.**

| Front matter | From the code |
|---|---|
| `colors.<name>` | `color-<name>`, the default theme's value |
| `rounded.<name>` | `radius-<name>` |
| `spacing.base`, `spacing.<name>` | `spacing`, `spacing-<name>` |
| `typography.<style>` | a text style of `design-system.json`, its tokens resolved to values |
| `components.<name>` | a component as it starts, `<name>-<variant>` and `<name>-<size>`, read from its classes by the style system |

- **The editor owns the mirrored groups:** `colors`, `rounded`, `spacing`, `typography` and
  `components`.
- **The document's authors own everything else:** `name`, `description`, `omitted`, unknown keys
  and the body. The editor never changes them, except to rename a token reference as described
  below.
- **When the code changes,** the mirrored groups are rewritten and the rest is left as it was,
  comments included.
- **When the document changes** (by hand, from Stitch, after a pull), each mirrored value is
  compared with the code's and with a baseline, exactly as Figma's tokens are (0025):
  - changed in the document only: the code takes it once the user confirms in Sync;
  - changed in the code only: the document is rewritten;
  - changed on both sides: the user picks.
  The baseline is `designMd` in `design-system.json`, committed: each mirrored value by its
  path in the document (`colors.primary`, `typography.body.fontSize`).

**A token of the document is matched before anything is taken**, as Figma's are (0025's
amendment). Rules take only what is certain: the code declares the name under that group's
prefix, or exactly one of the code's tokens of that kind has the same value. An agent takes the
rest with the user (`/sync design`), and its decisions are kept with `map_values`. Nothing that
is unmatched is written. Once matched, the document is rewritten in the code's names, and its
`{colors.tertiary}` references in the body are renamed with it. The code and the document then
speak one vocabulary.

**Text styles are matched by an agent, not by rules.** A text style's values are resolved from
tokens (`$text-4xl`). A changed `fontSize` in the document can mean a different token or a new
one. Sync lists the changed fields, and `/sync design` decides them with the user.

**Themes are not in the document.** The front matter has the default theme's values, and the
body says how dark mode (or any other theme) differs. The other themes' values stay in the code.

**`design-system.json` keeps what the format has no place for:** colour groups and per-token
descriptions (tooltips), how text styles are built from tokens (role, group, level, `$token`
references), component notes and example props, elevation, motion, layout, icons, theme names,
the tool's `omitted` (token and component names, not the format's sections) and the sync
baselines. It stays in the designs directory. It is the tool's file; `DESIGN.md` is everyone's.

**The document is linted with `@google/design.md`'s linter**, pinned and wrapped in one service
so it can be replaced:
- Errors (a broken reference, a duplicate section) refuse an agent's write.
- Warnings go back to the agent, and the Design system panel shows them.

**Agents write the body in the format.**
- `/init`, Define and `/sync describe` write the eight sections in order, the voice and the
  audience in Overview, and refer to tokens as `{colors.primary}`.
- `write_design_system` takes the document. It regenerates the mirrored groups itself, and a
  value the agent wrote that differs from the code's is put back, with a finding that says
  to change the stylesheet instead. An agent does not change values through the document; a
  person may.
- No MCP tool is added: `read_design_system` and `write_design_system` carry the document where
  they carried `notes`.

## Consequences

- Stitch's or a designer's `DESIGN.md` dropped into a repository is a way into Sync, like a
  `.fig`. A project with no application and a `DESIGN.md` starts from its tokens.
- What the format cannot hold stays in the code and in the body: shadows, motion, breakpoints,
  border widths, and font sizes no text style uses. Elevation & Depth and Layout describe them in
  prose. A value the format cannot hold, such as a `calc()` or a unit other than `px`, `em` or
  `rem`, is left out of the front matter, and Sync says so.
- The format is `alpha`. The version the editor writes and lints is pinned, and moving to a new
  one is a change of its own.
- The briefing gives agents the document's body; the token list it already has stays.
- The design skills do not change role or order: they are the craft that holds for any
  product, and they come first. `DESIGN.md` is this product, and it wins where the two
  disagree. Their wording names the section they defer to (Colors, the voice in Overview) rather
  than the whole file. A rule that holds only for this product belongs in Do's and Don'ts, not
  in a project skill.
- 0015's "DESIGN.md beside `design-system.json`" and its "the conventions, in prose" are
  superseded by this.
