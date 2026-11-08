# ADR 0069: The design skill is a core and its references

Status: accepted, 2026-11-08, after the lab measured it against the skill of 0048 (below).
Amends 0048 (the router), 0049 (two jobs), 0067 (the words) and the per-part overrides of 0046.
Keeps 0065 (DESIGN.md holds the product's choices) and 0068 (no site, person or paid face).

## Context

The router of 0048 told a design thread the rules every screen keeps and had it read each other
part "when the screen has one". The panel's read column measured that on the saved rounds: on the
shipped skill Claude opened 27% and 34% of the parts its sections reached; it read the four the
steps name, a pattern and the components, and left borders, states, usability, elevation, the
words and accessibility unread. Codex opened 92–100%, by reading every part at once, about 20K
tokens. A rule behind a pointer the agent does not recognise is lost, as the Agent Skills guide
warns ("the agent may not recognize the trigger"), while text always present is followed.

The skill had grown to 51 files and about 76K tokens. One rule sat in up to four files, every
part stated its rules twice (its body and its "Before you finish" table), and the patterns and
studies disagreed with the parts on eight rules. Of their 187K characters about 30% changed what
an agent draws: the rest was provenance, counts and the same recipe told once per topic.

Its words were the editor's page format (`textStyle`, `crossAlign`, `"$spacing-4"`, `at`) and
its editor-only sentences were markers the server resolved, so an agent outside the editor read
the markers raw, and the cache the briefing named kept them too.

## Decision

- **Every rule is in `SKILL.md`, the core**: the steps of the four jobs (a screen or page,
  reviewing one, the design system, only the words) and every rule that bears on most screens, one line with its
  value, each section ending on the file that holds its detail and when to open it. The checks
  are those lines: a check step runs them against every screen. Under 6,000 tokens.
- **The depth is by kind, chosen once.** Step 2 names the screen's job, its primary action and its
  kind, and opens the kind's file from the core's table: `references/kinds/` for a product's
  screens (dialog, settings, table, dashboard, form, navigation, feedback), `references/pages/`
  for public pages (landing, shop, portfolio, editorial, title). Each holds that kind's anatomy
  and values, with what the patterns and the studies' recipes said of it folded in, counts and
  provenance dropped, and names under its title the two to four topic files it is opened with
  (settings: components, typography, layout). An agent opens the kind's file every time; a
  "More: …, when" pointer it follows rarely.
- **The check opens what the screen has.** Before the check step runs the core's lines, it opens
  the topic file of every concern the screen has that is not open yet (its words, icons, states,
  surfaces…), and runs each file's check table. Reviewing a design checks the same way, from the
  picture, and reports each failure with its rule.
- **Topic files hold what a line cannot**: tables of values, presets, reasons
  (`references/character.md`, `layout.md`, `typography.md`, `color.md`, `surfaces.md`,
  `iconography.md`, `motion.md`, `picture.md`, `components.md`, `states.md`, `usability.md`,
  `accessibility.md`), with `system/` (foundations, components, extract, figma) and `words/`
  (voice, interface, pages). Every file is named by the core: one level deep. A file never
  repeats a core line; it ends on a check table of what it adds.
- **The web's terms.** The skill speaks of any web interface: a text style, a token by role, a
  step of the spacing scale, a breakpoint, CSS where it decides. No markers. The editor's terms
  and tools are the briefing's (`skillTerms`): a text style is `textStyle`, a token `"$name"`, a
  breakpoint `at`, the one question `ask_user`, Sync placing a component.
- **One skill.** The per-part built-in skills, their replace and extend files and their toggles are
  retired: a product's choices are DESIGN.md's (0065), and a project's own skill files are told
  whole as before. The design skill is on or off as one.
- **The eight disagreements are settled** by the person: field labels semibold; groups at least
  2× the gap within them everywhere; a dialog's or small form's title about `18–20px` semibold by
  the character; colour hover on a public page `150–200ms`; nothing under `12px` but an
  uppercase or mono label on a public page at `11px`; icon stroke matched to its text; the status
  badge the neutral filled Badge with a dot; the current navigation item in the foreground on its
  row's fill, by the character.

## Measured

Against the skill of 0048 on the same screens, in the editor's family hosts and outside it (a
plain React and Tailwind app with the skill in `.agents/skills/`, Codex never told of it). Problems
are what a Grok panel still finds per run; pairwise is a blind judge's pick, run by run (rounds
`rb-*`, `rb2*`, `rb3*`, `rb4*`, `rb6` in the lab's data).

| Version | Where | Problems per run, 0048 → this | Pairwise, this–0048 | Tokens per run |
| --- | --- | --- | --- | --- |
| The core alone | Codex, 8 screens | 24.3 → 26.7, 19.0 → 22.0, 30.7 → 31.0 | 3–8 | 1,083k → 974k |
| | Opus, 3 screens × 2 | 25.7 → 25.0 | 2–4 | 1,656k → 1,208k |
| Kind files naming their topic files | Codex, 8 screens | 24.3 → 23.7, 19.0 → 22.0, 31.7 → 31.0 | 5–5 | 1,007k → 966k |
| | Opus, 3 screens × 2 | 25.7 → 23.7 | 3–3 | 1,656k → 1,176k |
| | Outside, Codex, 6 screens | 31.5 → 35.0, 44.5 → 45.5 | 3–3 | 865k → 320k (2 screens) |
| With the settings rows (shipped) | Codex, 3 screens × 2 | | 3–3 | |

With no skill at all, outside the editor, Codex's pages had 47.5 problems per run against 31.5
with the skill of 0048, and it found the skill by its description in every run. A reviewer told
the core alone caught 59% of the 51 known gaps where one told 0048's caught 71%: it read 12 of the
skill's files where the other read 23. Opening every concern's file at the check (shipped) lifted
its reads to 14 and left recall at 59%; a review that opens every file before it looks was three
to four times slower and was not measured to the end.

## Consequences

- A design thread is told the core whole, about 23K characters against 19K for the router of
  0048, and reads its kind's file and the two to four topic files it names: a screen's design
  costs Codex about as many tokens as before and Opus about a quarter fewer. The skill is about
  38K tokens, from 76K. The panel finds as much in its designs as in 0048's, and pairwise splits
  even; it is shipped for being half the size, readable outside the editor and as good, not
  better.
- A reviewer told the skill, as step 6 starts one outside the editor, finds fewer of the known
  gaps than one told 0048's (59% against 71%); the editor's own review loop gives its reviewers no
  skill and is not affected. Getting recall back without reading the whole skill is open.
- The lab photographs a page whose foot is pinned to the window (a sidebar's account row) at the
  window's height: the frame used to grow with the foot and draw empty windows above it, which the
  judge and the panel took for a stranded row. Rounds before that fix keep their pictures.
- The panel's read column measures the new skill by the files a run's sections needed beyond the
  core; the lab's candidates are whole skill trees.
- The skill installs as it is in `.agents/skills/` or `.claude/skills/`. It is not published yet.
- A deterministic checker for the mechanical rules is its own decision, after this ships.
