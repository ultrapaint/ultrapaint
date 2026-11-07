# Plan: the design skill, rebuilt to be read

Status: proposal, 2026-11-07. Nothing here is decided; the open choices are the deck
`decisions/design-skill.json` in the data directory (`pnpm evals decide design-skill`). It would
amend ADR 0048 (the router), 0049 (two jobs), 0067 (the words) and the per-part overrides.

## What we have

`skills/ultrapaint/` is 51 files, 289K characters, about 76K tokens:

| Part | Files | Chars | ~Tokens |
| --- | --- | --- | --- |
| `SKILL.md`, the router | 1 | 5.1K | 1.3K |
| `references/*.md`, one per part | 19 | 81K | 21K |
| `design-system/`, `content/` | 7 | 27K | 7.3K |
| `patterns/` | 13 | 66K | 17K |
| `studies/` | 9 | 108K | 28K |

A design thread is told the router with character, hierarchy and restraint (19.2K characters,
about 5K tokens; ADR 0048 said 12K when it shipped). Step 3 sends it to layout, spacing,
typography and colour, about 12K tokens by then. Everything else is read when the agent decides
the screen reaches it.

## What is wrong

**The rules are not where the agent is.** A rule behind a "when the screen has one" pointer is
read only when the agent notices the trigger, and the Agent Skills guide says it plainly: for a
non-obvious case "the agent may not recognize the trigger". In the lab, Claude's router arms read
the step-3 four, and then iconography and components, every run, whatever the screen holds: a
fixed batch, not a read by need. Codex (`design-after-codex`) never opened the four. Nothing
measures whether a part was read when the screen needed it.

**One rule, many places, some disagreeing.** "Foreground 15:1, muted 4.5–5.5:1" is in the router,
`color.md`, `design-system.md` and `foundations.md`. Each part states its rules in the body and
again in its "Before you finish" table. Patterns and studies disagree with the parts on eight
rules (field labels medium or semibold, group gaps 2× or 3×, a small dialog's title 24px or body
size, hover 150–200 or 200–300ms, labels under the 12px floor, icon stroke fixed or matched,
the status badge outlined or filled, the active navigation label).

**The depth files are mostly provenance.** Of patterns' and studies' 187K characters, about 30%
changes what an agent draws. The rest: the same sample paragraph in all 21 files (about 9K),
393 inline "(~n notes)" counts, per-character count triplets, anonymised site lists, lessons from
a sample of one, and rules of the parts restated to say the parts win. The study recipes are
page kinds told once per topic: a technical hero in six study files, pricing in seven.

**It is not usable outside the editor.** Its words are Ultrapaint's page format (`textStyle`,
`crossAlign`, `"$spacing-4"`, `{op: "update", at: "md"}`, nodes, the palette), and
`[with the editor's tools: … | without: …]` markers are resolved only by the server. Nothing
installs it outside this repository.

**Delivery bugs, today:**

- The references written to `~/.cache/ultrapaint/skills/<hash>/` are raw: `color.md` there still
  carries three markers and `layout.md` two, and `` `references/studies/layout.md` `` points into
  a `references/` folder the cache does not have (`services/skills.ts:96-110`).
- Router step 7 has the designer start a reviewer; the briefing's `DESIGN_CHAT` says the editor
  runs the review and the agent must not.
- `reads.json` counts tool-call titles, failed calls, partial reads and only the last item of a
  shell brace list; `content/` and `design-system/` files are counted under the wrong name.
- In router mode, turning a part off changes nothing: the router still names its file.
- `docs/user/reference.md:57` still calls `full` the default.

## What the evidence says

- Agent Skills spec and Anthropic's guide: `SKILL.md` under 500 lines and 5,000 tokens, references
  one level deep, a pointer that says *when* to read, a table of contents in a long file.
- SkillsBench (arXiv 2602.12670): focused skills +17–19 points, comprehensive ones −2.9; two or
  three modules beat four or more.
- Vercel's evals: a skill went unused in 56% of cases; a compressed always-present index scored
  100%. Always-present text is followed (ETH, arXiv 2602.11988).
- shadcn's skill keeps every critical rule in `SKILL.md` as one line ending on its detail file:
  a skipped pointer loses the example, never the rule.
- Impeccable runs a deterministic checker as a PostToolUse hook in Claude Code, Codex, Cursor and
  Copilot, and a deep pass on Stop: "without the hook, the detector only runs when someone
  remembers to run it."

## The design

Three moves: **every rule in the core, depth by kind, the product's terms out.**

```
ultrapaint/
  SKILL.md        the core: when, the steps, every rule as one line with its value → detail
  kinds/          one file per product screen: dialog, settings, table, dashboard, form,
                  menus and navigation, chat and toasts; its anatomy and numbers
  pages/          one file per public page: product landing, shop and hospitality, portfolio,
                  editorial, title screen; one recipe with its type, colour, space, image, motion
  details/        what a core line cannot hold: character's presets, the type and colour
                  tables, motion values, states, accessibility, usability
  system/         making the design system: foundations, components, extract, figma
  words/          voice, interface, public pages
  scripts/check   later: the mechanical checks, run on a rendered page
```

### The core is the skill

`SKILL.md` holds every rule that bears on most screens, once, as a line with its value, and the
file that has its detail: "Groups sit at least 3× further apart than their items, measured
between the text (`8` within, `24`+ between) → `details/spacing.md`". The "Before you finish"
tables become these lines: the check step runs the core against every screen, plus the short
table of each file read. Target: under 5,000 tokens, against today's 12K for the router and the
seven files every screen reads.

Inside the editor the briefing tells the core whole; outside, it is the body an agent loads when
the skill triggers. The two read the same text.

### Depth by kind, chosen once

Step 2 already has the agent name the screen's job. It names its kind there from a table in the
core, and reads that one file before the first node. A kind is one discrete choice made once,
where "the screen has icons" is a judgement made never. Each kind file folds what its pattern,
the study recipes and the parts say about that kind: about 1,500 tokens, counts and provenance
dropped, the sources named once in the skill's README, which does not ship. Every file is
reached from `SKILL.md` directly: one level deep.

A typical screen reads the core and one kind, about 6.5K tokens, where today it reads the router
and seven to nine files, 15–20K. Total skill: about 30K tokens, from 76K.

### The product's terms out

The skill speaks the web's terms: a text style, a step of the spacing scale, a token by role, a
breakpoint, CSS where it decides (`text-wrap: balance`). DESIGN.md stays: it is the open format.
The markers go. What the editor changes moves to where the editor speaks:

- the briefing gains one table of how the skill's terms map onto the page model (a text style is
  `textStyle`, a token is `"$name"`, a breakpoint is `at`, check a width with `get_screenshot`);
- what each tool does stays in its description;
- Sync and the default look stay in the briefing, which already says them.

The skill installs as it is: `.agents/skills/` and `.claude/skills/`, and published for
`npx skills add` and as a Claude Code plugin.

### Checked, not only read (after the rebuild)

The mechanical rules are checkable: a raw colour or size, a gap off the scale, more than three
sizes on a product screen, a foreground under 15:1, two primaries, text under 12px, a measure
past 75 characters, a group gap under 3× its items. `scripts/check` runs them on a rendered page
in any agent; in the editor the same rules run on the page model and come back with
`apply_operations` and in the review loop. Its own decision once the rebuild has shipped.

## Steps

1. **Fix the delivery bugs** above. They hurt every thread today, whatever comes next.
2. **Fix the instruments.** `reads.json` from the tool calls' arguments and results, brace lists
   expanded, every file by its path. A *read-when-needed* score: for each section the panel
   found reaching a part or kind, was its file read before the section's first node. A run of
   the skill outside the editor: installed in a plain host repository, Claude Code and Codex
   writing React and Tailwind, screenshotted and judged by the same panel.
3. **Settle the eight contradictions** (the deck), so the rebuild carries one answer each.
4. **Write the candidate** in a worktree: the core, the kinds, the pages, the details. Every rule
   of today's files is either in it, folded, or listed as cut with its reason, so the diff can be
   reviewed rule by rule. The 25 open gaps' rules land in their file.
5. **Measure it** against the shipped skill: recall on the review references, pairwise on two
   hosts with Opus and GPT-6.1-Sol, read-when-needed, tokens per run, and the outside run. To
   ship: no worse on the panel, read-when-needed at 90% or more on both models.
6. **Ship it in the server**: the briefing tells the core; the adapter table; the markers, `ORDER`,
   `TOLD_WITH_ROUTER` and the per-part overrides change as the deck decides; review
   `CATEGORIES` stay as names of concerns, not files; an ADR amending 0048.
7. **Publish it**, then decide on the checker.
