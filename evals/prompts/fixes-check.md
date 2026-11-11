Reviewers found the problems below in the editor's {{name}}, as its pictures show it and as its
code was then. The person and a designer with the skill agreed each is worth fixing. The code has
changed since: say which still hold today, and what fixing each would take now.

The pictures and the code as they were, in this directory: {{pictures}}

{{oldCode}}

The code as it is today, in the repository at `{{checkout}}`:

{{newCode}}

Read today's code first, then each problem against it. Several problems are often one, found by
different reviewers in other words, or in two states of the same panel: say so.

The problems, numbered:

{{problems}}

For each problem, by its number:

- `same`: the number of an earlier problem it repeats, or 0;
- `holds`: `yes` when today's code still does what the problem says, `no` when it was fixed or
  the element is gone, `unsure` when only a new picture could tell;
- `where`: where it is today, as `file:line` from the repository's root, or empty when it holds
  no more;
- `size`: what the fix takes today: `small` (a class, a prop or a word on one element),
  `medium` (one component's markup or behaviour) or `large` (several components, or a decision
  the product has not made);
- `fix`: the fix for today's code, in one concrete sentence; empty when it holds no more.
