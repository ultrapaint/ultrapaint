A reviewer looked at one section of an interface and listed the problems they found. A person had
already reviewed the same section; their findings are below. Say, for each of the person's
findings, whether the reviewer found it.

The section: {{name}}. {{where}} Its pictures are in this directory, for when a finding needs
looking at:

{{pictures}}

The person's findings:

{{gaps}}

The reviewer's findings, numbered:

{{findings}}

For each of the person's findings, by its id, a `verdict`:

- `caught`: one of the reviewer's findings names the same problem on the same element, in other
  words or with another fix;
- `partly`: one touches it and misses what made it a problem: the right element with another
  defect, or the defect in general without this element;
- `missed`: none does.

With it, `findings`: the numbers of the reviewer's findings that match (none when missed), and
`why`, in one sentence. One of the reviewer's findings may match several of the person's.
