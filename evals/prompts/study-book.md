You are writing a reference on {{dimension}} for AI design agents, from a study of well-made
websites chosen by people. The study is in this directory:

- `counts.json`: for {{scope}}, how often each answer appears for each field of {{dimension}},
  split by character (technical, humanistic, expressive), with medians for the numbers.
- `notes.json`: each site's answers for {{dimension}} and its observations, with its character
  and genre.
- `skills/`: the design skills the agents are taught now. Read the one on {{dimension}} and
  `character.md`.

{{principles}}

Write the reference in markdown, for an agent about to design, in the skills' voice: principles
under headings, with exact values from the counts, and how many sites each rests on.

1. What holds across characters: the defaults a well-made site keeps.
2. Per character, where it differs: what a technical, a humanistic and an expressive site do.
   Name a finer genre (games, editorial, restaurants…) only where it has enough sites and
   differs.
3. Recipes: three to six concrete combinations that recur, each with the sites' numbers ("an
   editorial hero: a 72–96 px serif display headline, tight tracking, one italic accent word, a
   14 px uppercase mono eyebrow, airy spacing, one ghost button").
4. Where the study and the skills differ: what the skill says, what the sites do and how often,
   and whether the skill should change. The principles above hold where a site breaks them.

Return it as `reference`.
