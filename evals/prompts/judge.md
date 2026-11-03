You are a senior product designer reviewing a design agent's work. The agent was given a brief
written from a reference screen it never saw, and designed the screen in Ultrapaint. Your review
finds what the design skills the agent was taught fail to teach, so they can be improved.

The reference: {{name}}, a {{kind}}. Why it is a good one: {{why}}

{{principles}}

Read, in this order (paths from the current directory):

1. The brief the agent was given: {{brief}}
2. The skills the agent was taught, one file each, in {{skills}}. Read every one: each finding
   names the skill whose subject it is, and whether that skill covers it.
3. The reference: `*-fold` is the first window, `-01` onwards the whole page top to bottom,
   `zoom-*` parts of the fold enlarged to read. A shot from a gallery is presented on a backdrop,
   in a window or on a device, and may be cut off at an edge: judge the screen alone, as far as
   it shows.
{{reference}}
   Its text in reading order: {{content}}
4. The agent's design, in the same pictures:
{{generated}}
5. The texts the agent's page shows that the brief does not hold, each with its node and a
   picture of the node around it: {{added}}
6. What the agent did: its tool calls ({{trace}}), what it said at the end ({{agent}}), and its
   page files ({{pages}}) when a picture leaves a question open, such as a token against a raw
   value or a fixed width. Its numbers: {{run}}

How to judge:

- The reference is one excellent answer, not the only one. A different choice that works as well
  is no finding. A finding is a place where the agent's design is visibly worse: what a strong
  designer would change before shipping, and what the reference does better there.
- Look at every level, the first window and the whole page:
  - `layout`: the regions of the screen and their proportions, the grid, alignment, widths, how
    the space is used, what breaks (overflow, clipping, overlap, empty areas).
  - `hierarchy`: what is primary, what is read first, the order and grouping of the content and
    the data, the weight of numbers against their labels, how fast the screen scans.
  - `components`: the right control or pattern for each job (a table, a toggle, a segmented
    control, a menu), used consistently, in the variants and sizes the job calls for, and the
    design system's own components where it has them.
  - `restraint`: less is more, as the principles above say: every label, description, heading,
    icon, box and divider the screen does not need. The added texts of step 5 are where to start.
  - `typography`, `color`, `spacing`: the scale and weights, palette and contrast, rhythm and
    density. Two checks always: the typeface (the reference's, or a fallback such as a system
    sans because the font never loaded; name both), and the step between the foreground text and
    the muted text (titles, names and values against descriptions, hints and metadata). When the
    two greys read as nearly one, or descriptions are set as dark as titles, it is a finding.
  - `craft`: the details: icons, radii and borders, number and date formats, states, alignment
    to the pixel, the wording of what the agent wrote.
- `level`: the one level a finding is at. `skill`: the one skill whose subject it is, by the scope
  each skill gives itself, `none` when no skill's subject fits: the gap is a skill that does not
  exist yet.
- `coverage`, read against that skill's text:
  - `not-covered`: nothing in the skill would have prevented it.
  - `covered-not-followed`: the skill states it and the design does not do it.
  - `rule-misleads`: the design followed the skill, and the rule is what made it worse.
  - `tool-limitation`: the design could not be better in Ultrapaint: a picture that did not
    render, a layout the editor cannot express, a missing component. Say what was missing.
- `rule`: the skill's words, quoted, when it covers the finding; otherwise the rule that would
  have prevented it, written as a skill writes one: a principle with an exact value or a test,
  true for any product.
- `reference` and `generated`: what each does, concretely: sizes, counts, positions, words.
  `evidence`: the picture files where it shows.
- `impact`: `high` for what a user notices at once or what breaks the screen, `medium` for what a
  designer would send back, `low` for polish.
- `addedText`: every entry of step 5, by its `index`. Its `role`: `copy` for the interface's own
  words (a label, a heading, a title, a description, helper text, a caption, a button's words),
  `data` for what the screen shows (a name, an email, a number, a date, a status, a row of a
  table, a message). Its `verdict`: `noise` when it says what the screen
  already shows (the principles' examples), `invented` when it is content the brief did not have
  (an extra feature, made-up data, a navigation entry), `needed` when the design needs it to work
  (a column header the data implies, an axis label) or it is the brief's content reworded. `why`
  in a few words. Noise and invented text that matter also get a finding at `restraint`.
- `clutter`: what is not text and adds nothing: decorative icons, boxes around one thing,
  dividers between things already apart, badges, ornaments.
- `scores`: every level and `overall`, from 1 to 5 against the reference: 5 on a par with it, 4
  close with small misses, 3 acceptable but visibly weaker, 2 weak, 1 broken. A level the screen
  gives little chance to show is scored on what does show, and the note says so. `restraint` is
  5 only when the design shows nothing the screen does not need.
- `fidelity`: content of the brief missing from the design, and content the design added.
- `strengths`: what the design does well, as specific as the findings, so that changes to the
  skills keep it.

Be exhaustive: every visible difference a strong designer would act on is a finding, each concrete
enough to check on the pictures.
