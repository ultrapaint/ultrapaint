# ADR 0048: The design skill is a router, and a design thread is told it

Status: accepted, 2026-11-02. Amends 0046 (the briefing's default, which it left at `full` until
the design evals agreed) and 0043 (what an agent reads says each thing once).

## Context

The design skills were eighteen skills, `skills/design/<name>/SKILL.md`, each with references of
its own, and a design thread was told every one that is on, whole: about 33,000 characters before
its first prompt, most of them about what the screen in hand does not have (motion, a design
system, a picture, states). An agent outside the editor saw eighteen skills where it wants one,
and had to know which to load.

The study of 4,983 sites and the patterns' corpus made the parts longer, so telling everything
up front only grows.

## Decision

The design skill is one skill, `skills/ultrapaint/`, named after the product so an agent that
finds it elsewhere knows where it is from:

- `SKILL.md` is a router: the rules every screen keeps (one sans, neutral or warm neutrals, two
  text colours, quiet badges, less is more), the steps of a design, and a table of the parts a
  screen reaches only when it has one (elevation, borders, iconography, motion, content, states,
  components, design system, picture, accessibility). The steps have the agent read layout,
  spacing, typography and colour before it draws a node, and end with every reference read run
  through its "Before you finish" table, named in the last message.
- `references/<part>.md` holds each part whole, with the patterns and the study's findings in
  folders of their own. Each part is still a built-in skill of its name in the server, so a
  project's file replaces or extends it and the settings turn it off as before.

`skills.briefing` gains `router`, and it is the default: a design thread is told the router with
character, hierarchy and restraint whole (what every screen needs before its first step) and the
project's own skill files, about 12,000 characters. The rest is read from the references, which
the server writes once to `~/.cache/ultrapaint/skills/<hash>/`, the router's `references/` mentions
rewritten to that folder, so they are there before any briefing names them and also for an agent
that reads `skill://ultrapaint/<part>` first. `full` and `summaries` stay settings.

A thread whose task makes the design system (`/init`, `/import-figma`, the setup's Define step;
`designsTheSystem`) is told the design-system part whole with the router as well: it is the one
part that task always reaches, and the router alone would leave it to the agent to open.

## Why the default flips

The design evals compared the two on the same references, judged blind and side by side by Opus:

- on the family host with an attached picture (8 references, 2 runs each), the router won 10 of
  16, each loss slight; the lab's overall mark went from 3.4 to 3.6,
  on a median of 1.8M tokens a run against full's 2.5M;
- that round showed the router's agents opening two references, never layout or typography, so
  the steps were made to read those first and to say which were read; after that, on an empty
  host (3 references) the router won 3 of 3, overall 2.7 to 3.3, typography 2.0 to 3.0; on the
  starter host full won 2 of 3, one of them clearly (dark text on black).

14 of 22 for the router is a lean, not proof. The router is the default for its structure: one
skill to find, each rule in one place, the briefing a fifth of the size, a part read when the
screen reaches it. It saves tokens only while the agent reads little: once the steps had it read
its references, it spent about twice as many on the empty host and as many on the starter.

## Consequences

- A thread that reads no reference designs from the router's rules alone; the steps and the
  closing message are what keep it reading, and the design evals watch it (`reads.json` beside a
  pairwise round).
- A project that set `skills.briefing: "full"` keeps it; one that set nothing gets the router.
- A rule said in the router and in its part is said twice; the router keeps only what every
  screen needs.
