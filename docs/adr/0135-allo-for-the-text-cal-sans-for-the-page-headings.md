# ADR 0135: Allo for the text, Cal Sans for the page-size headings

Status: accepted, 2026-11-24. Amends 0070 (the editor's faces) and 0072 (the faces' custom
properties).

## Context

0070 set the editor's headings in Cal Sans and every other role in Figtree. Cal Sans has one weight
and is drawn for display sizes, so the small headings, a dialog's title at 16px and a panel's or a
field's label at 14px, had to be opened by 0.02em, and were still set apart from the text by their
face alone. The person asked for Cal Sans on the biggest headings only, and for everything else,
the small headings and the text, in Allo at 20% of its roundness.

Allo (allo.joshpuckett.me, by Josh Puckett) is a variable sans drawn from Inter 4: weight 100–900,
roundness (`ROND`) 0–100 with 50 its default, and an optical size (`opsz`, 9–32) that follows the
font size. It is under the SIL Open Font License 1.1 with no Reserved Font Name, free, and may be
bundled with the desktop app and served by the editor, modified or not; the file carries its
copyright and licence in its name table. It covers Latin in 50+ languages, Italian's accents among them, with
true obliques, tabular figures and interface arrows.

## Decision

- **Cal Sans keeps the page-size headings**, 20px and up: `font-heading-xxlarge`, `-xlarge`,
  `-large` and `-medium` (today the opening splash's title), as 0070 set them.
- **Allo sets the small headings and every body**: `font-heading-small` (16/20),
  `-xsmall` (14/20) and `-xxsmall` (12/16) at 600, the design skill's weight for a dialog's or a
  panel's title and a field's label; the bodies keep their sizes, line heights and weights (400,
  500, 600). Allo's optical size spaces it for its size, so every Allo token is tracked 0; the
  small headings lose 0.02em and their `font-synthesis: none`, which only Cal Sans needed.
- **The roundness is pinned in the font file**: `apps/web/src/fonts/AlloVariable-ROND20.woff2` is
  Allo 1.0.3's variable font with `ROND` instanced at 20 by fontTools (235 kB where the full file
  is 448 kB), weight and optical size still variable, beside `OFL.txt` and a README with the
  command. `styles.css` declares it as `"Allo Variable"`, `font-weight: 100 900`,
  `font-display: swap` as the other faces. Set as a `font-variation-settings`, the roundness would
  either not hold everywhere (the `@font-face` descriptor is not in Safari, and in Chromium only
  since 140) or, as an element's property, be inherited by the designs drawn on the canvas and
  change any of them set in Allo or another face with a `ROND` axis.
- The faces' custom properties are named by what they set: `--face-display` (Cal Sans),
  `--face-text` (Allo) and `--face-code` (Geist Mono), where they were `--face-heading` and
  `--face-body`.
- Geist Mono stays for blocks of code alone (0117).
- The splash drawn before the editor's code (`index.html`) and the boards' documentation
  (`UI_FONT`) take Allo where they took Figtree; `@fontsource-variable/figtree` is gone.

## Consequences

- At one size Allo is about 3% wider than Figtree and its x-height 9% taller, so text reads a little
  larger: a description in a narrow column can take a line more, a name cut by its row a character
  sooner.
- A heading of the editor's chrome and its text now share a face; a small heading is told apart by
  weight, Cal Sans marking only a page's own title.
- Changing the roundness, or taking a newer Allo, is making the file again from the `allo-font`
  package's, by the command in `fonts/README.md`.
