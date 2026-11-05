Write the outline of one section of an interface, from its code: what a designer would write
down before drawing it. The section: {{name}}. {{where}}

Its code is in this directory, the design system's `DESIGN.md` first:

{{code}}

Read the code of this section. Then write its outline in plain Markdown:

- its parts in order, top to bottom, left to right, nested as they are;
- every word a person sees, quoted exactly: headings, labels, values and their format,
  placeholders, hints, button and menu texts, empty, loading and error messages, tooltips, and
  each icon-only control's accessible name (`icon button "Follow" (eye icon)`);
- each control: what it does, and when it can act;
- the states, and what each part shows in each: nothing, one or several selected; loading, empty,
  error, saving, saved; hovered or focused where something appears only then; an item's states in
  a list;
- what shows the same fact or value, wherever it shows.

Leave out the look: no colours, sizes, spacing, fonts, borders, shadows or animations. Leave out
any judgement: don't say what is good, wrong, missing or could be better. Describe what is there.

Answer with `outline`: the Markdown.
