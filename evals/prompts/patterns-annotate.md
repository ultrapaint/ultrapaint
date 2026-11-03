You are cataloguing how a very well designed product's interface is built, so its patterns can be
counted across hundreds of pictures and taught to design agents. The product is {{product}}. Each
picture is a piece of it: a screen, a section, a dialog, a menu, a single component, or a set of
them laid out together.

The pictures, in this directory; read every one:

{{files}}

For each picture, by its file name, answer what is visible, as exactly as the picture allows.
Sizes are in pixels of the interface at its own scale (a body text line is about 14–16 px; judge
from that), estimated. A picture may sit on a backdrop or in a browser or device: describe only
the interface.

- `shows`: `screen`, `section`, `dialog`, `menu`, `component`, `set` (several pieces side by
  side), or `skip` when nothing can be read.
- `kind`: what it is, in two or three generic words ("settings page", "share dialog", "data table",
  "sidebar navigation", "date picker", "pricing section", "account menu", "empty state").
- `grouping`: how the content's groups are told apart: `cards` (each group on its own bordered or
  filled surface), `dividers` (lines between groups on one surface), `space` (only space between
  groups on one surface), or `mixed`. `nesting`: how many surfaces deep the deepest content sits
  (0 for none). `groupingNote`: one line on how it is done.
- `headers`: each header of a group or of the piece: `level` (`page`, `section`, `card`,
  `dialog`), `words` in its title, `descriptionWords` (0 when there is none), `actions` (buttons
  or links beside it).
- `fields`: text fields and selects: `count`, `withLabel`, `withHelperText` (a line under or
  beside it), `placeholderOnly` (no label).
- `choices`: checkbox, radio and toggle rows: `count`, `withDescription`.
- `listRows`: rows of a list or table: `count`, `linesPerRow` (typical), `withIcon` or avatar.
- `spacing`: `withinGroup` (between items of one group), `betweenGroups`, `containerPadding`
  (inside a card or dialog), each in px, 0 when not seen.
- `actions`: buttons by role: `primary`, `secondary`, `tertiary` (text-only) counts, and
  `placement` of the main ones (`header`, `footer-right`, `footer-full-width`, `inline`, `none`).
- `type`: `sizes` (distinct text sizes) and `weights` (distinct weights).
- `icons`: where icons are used: `navigation`, `buttons`, `fieldLeading`, `labels`, `listRows`,
  `headers` (featured icon), `decorative`: each true or false.
- `color`: `accentUses`: what the accent colour marks (the primary button, the selected item,
  links…), in a few words.
- `observations`: two to five patterns worth teaching that the fields above miss, each one line,
  concrete ("each settings row is a two-column grid: label and hint left, control right").
