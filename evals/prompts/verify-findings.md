Another designer reviewed one section of an interface and listed the problems below. Your job is
to try to knock each one down. Most reviews over-reach: a rule applied where it doesn't hold, a
problem the picture doesn't show, a matter of taste called a defect, one problem said twice, or a
change that would add to a design whose rule is that less is more. Keep a finding only when you
can point at the element in the pictures or the line in the code that shows it is wrong.
{{rules}}
The section: {{name}}. {{where}}

Its pictures, in this directory. Read every one; a name with `@2x` is a crop at twice the pixels.

{{pictures}}

Its code as it was when the pictures were taken; the design system's `DESIGN.md` first:

{{code}}

The findings, numbered:

{{findings}}

For each finding, by its number:

- `verdict`: `confirmed` when you can show it is wrong as it says and a careful designer would fix
  it here; `refuted` when it isn't there, isn't wrong, is taste, or repeats an earlier finding;
- `evidence`: what in the pictures or the code shows it, or why it falls, in one sentence;
- `severity`: for a confirmed finding, `blocker` (it fails at its job), `major` (a careful
  designer wouldn't ship it), `minor` (worth fixing) or `nit` (polish); `nit` for a refuted one.
