Below are problems found in interface designs: screens of a product (panels, dialogs, settings)
and pages. For each one, say how it could have been caught, the cheapest reliable way:

- `code`: a **general check** catches it: one rule written once for every screen, before anyone
  knew of this problem, that a program runs on the rendered page (each element's box, computed
  styles, colours, text) or the design document, with a threshold. For example: text contrast
  below 4.5:1, a target under 24×24, a gap between groups not three times the gap within one, a
  value off the design system's spacing scale, nested surfaces less than a tone step apart, text
  that overflows or can't truncate, a rule off its bar's centre line. A check that only works
  because it names this screen's elements or this problem's numbers ("flag the 24px where this
  dialog should have 20px", "flag this folder repeated") is not general: then it is `outline` or
  `eye`. Name the general check in `check`, in a few words, the same words for the same check.
- `outline`: a text outline written before anything is drawn would show it, with no pixels and no
  styles: the sections in order, every word on them, each control and what it does, which states
  exist (none, one, many selected; loading, empty, error) and what shows in each, and where each
  action sits. For example: an action offered where it can't act, a missing error state, one fact
  shown twice, labels of one list in different forms, a confirm where undo exists. Say what in
  the outline shows it.
- `eye`: it takes seeing the rendered look: what an icon suggests, a visual weight or balance, a
  style that reads wrong, how something feels. Say what has to be seen.

Choose the cheapest that would catch it reliably: `code` before `outline` before `eye`. Judge each
problem as described; don't argue with it.

The problems:

{{findings}}

Answer with `items`: one per problem, in the order given, each with its `id` as given, `catch`,
`check` (the general check's name for `code`, empty otherwise) and `how` (one sentence).
