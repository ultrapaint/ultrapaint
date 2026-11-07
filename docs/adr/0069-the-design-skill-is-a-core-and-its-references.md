# ADR 0069: The design skill is a core and its references

Status: proposed, 2026-11-07; accepted once the lab measures it against the shipped skill.
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

- **Every rule is in `SKILL.md`, the core**: the steps of the three jobs (a screen or page, the
  design system, only the words) and every rule that bears on most screens, one line with its
  value, each section ending on the file that holds its detail and when to open it. The checks
  are those lines: a check step runs them against every screen. Under 6,000 tokens.
- **The depth is by kind, chosen once.** Step 2 names the screen's job, its primary action and its
  kind, and opens the kind's file from the core's table: `references/kinds/` for a product's
  screens (dialog, settings, table, dashboard, form, navigation, feedback), `references/pages/`
  for public pages (landing, shop, portfolio, editorial, title). Each holds that kind's anatomy
  and values, with what the patterns and the studies' recipes said of it folded in, counts and
  provenance dropped.
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

## Consequences

- A design thread is told the core whole, about 21K characters against 19K for the router of
  0048, and reads one kind's file where it read seven to nine parts: a screen takes about 6.5K
  tokens of the skill where it took 15–20K. The skill is about 30K tokens, from 76K.
- The panel's read column measures the new skill by the files a run's sections needed beyond the
  core; the lab's candidates are whole skill trees.
- The skill installs as it is in `.agents/skills/` or `.claude/skills/`. It is not published yet.
- A deterministic checker for the mechanical rules is its own decision, after this ships.
