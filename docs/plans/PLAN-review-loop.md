# Plan: designs reviewed inside their loop, by reviewers the person picks

Status: in progress, as of 2026-11-10; proposed 2026-11-04, amended 2026-11-05. Decisions in
ADR 0060 (the council) and ADR 0061 (checks before reviews), both accepted. Builds on 0059 (gaps
measured by recall). Shipped: phases 1 and 2, the skill's review role (phase 4), the editor's
review loop and its settings (phase 5, built as ADR 0063 from
[PLAN-design-chat](done/PLAN-design-chat.md)) and triage (phase 6, ADR 0066). Open: the
experiment (3), the outline step (4), the checks at each edit and the other harnesses (5), trim
and the benchmark (6). Each phase says which below.

## Why

A fresh reviewer finds most of what a design gets wrong: on the editor's own panels it caught 57
of 66 known problems. The design skill's step 7 asks the designing agent to start one, and in a
design round Claude skipped it in 6 of 6 runs while Codex ran it in 6 of 6 (gap p08). A review
at the very end also comes late: the person wants it inside the build, look and adjust loop, by
the agents they choose (for this repository Opus, GPT-6.1-Sol and Grok 4.7, which find partly
different problems), and every finding kept so the skill learns from them.

## Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | What starts a review | The end of a turn with sections edited since their last review. Section by section, the designer ends its turn after each one; no review tool |
| D2 | Who reviews | The council the person names, per user, project or run (the run's wins); when none is named, the strongest model of each provider that can be reached |
| D3 | A finding the designer disagrees with | It fixes or declines each one, a decline with its reason. Reviewers only look |
| D4 | The findings | Opt-in log in `~/.ultrapaint/findings/<project>.jsonl`, outside every repository: category, rule cited or none, skill version, what the designer did. Triage (issue #8) turns recurring ones into gaps |
| D5 | When in the loop | End of the turn by default; section by section measured against it in the lab |
| D6 | One skill | The reviewer is the design skill in its review role: the skill gains a short section on reviewing a section, which the lab's recall reviewers read too |
| D7 | The score | Each reviewer 0–100, overall and per category (the skill's references), computed from its own findings by contracts' `review`; no council score; "no score" for a reviewer that gave no review |
| D10 | How much of the council looks | Each round: one member, the members in turn (default) or all; sign-off: the whole council (default) or the round's own reviewer. Chosen in the editor's settings, per project, when a design starts, or in the request (ADR 0061) |
| D9 | What comes before a review | An outline run against a checklist before the first node; general checks at each edit (values off the design system in the document, the rendered checks shown precise); then the review by the council, as D10 says (ADR 0061) |
| D8 | When to stop | A score asked holds every reviewer to it (own targets, advisory reviewers and category floors optional); none asked, every reviewer signs off. Caps: 6 rounds, 2 rounds under 2 points of gain, budget; the best round is kept |

## Phases

1. **The lab** (2026-11-04, on main): `pnpm evals round --review end|each-section --reviewers …`
   with `--goal`, `--reviewer-goals`, `--floors`, `--max-rounds`, `--budget` and
   `--log-findings`; `panel` scores each model 0–100. Smoke on one screen, one run each: no review
   left 27–32 problems, one review at the end 20, section by section 12, at 2× and 5× the time.
2. **The shift-left tests** (2026-11-05, `runs/shift-left-1/summary.md`): `catchable` sorts every
   finding by how it could be caught, `measure --checks --hover --stress` runs the general checks
   on a rendered page, `recall --inputs outline` reviews from an outline alone, `off-system`
   counts the values a round's pages leave off their design system. Recall records seconds and
   tokens per review.
3. **The experiment, after the 7-day quota resets (2026-11-09).** One design round, Claude and
   Codex designing three references: the council every round (ADR 0060) against the layers of
   ADR 0061 (outline, checks, then the council in turn: `--each-round rotate --sign-off all`). Scored by the person's blind picks, the gaps
   and `measure`, not by reviewers alone; with each arm's tokens and time.
4. **The skill.** Its outline step and checklist, its review role (categories, severity, rule, sign-off, read-only) and the
   step that answers reviews, shipped when phase 2 shows the loop helps.
   - Shipped, 2026-11-08 (ADR 0069): the review role is the core's job "Reviewing a design", and
     step 6 of a screen's job answers the findings of a review made for it.
   - Open: the outline step and its checklist.
5. **Harnesses.** The checks at each edit in the editor's write tools (their results in the tool's
   answer, no new tool), a script of them in the skill for other harnesses. The review's
   settings (contracts' `ReviewSettings`) in the editor:
   - **Settings › Agents › Review:** on or off; the council (the agents and models this machine
     has, in order); each round (One · In turn · All); sign-off (Everyone · The round's
     reviewer); the goal (Until they sign off, or a score, with a reviewer's own target or
     advisory); when (End of turn · Each section); the findings log. Kept in the user's settings,
     and in `ultrapaint.config.json` under `review` for a project.
   - **When a design starts:** the new chat's composer has a Review popover with the same fields,
     filled from the settings, for this design only; a plain popover, as the toolbar's are.
   - **In the request:** what the person says ("Opus and Grok, every round, until 90") is read
     into the same fields, and the popover shows what was understood. Where the designer runs, the council is started: the editor (a server service,
   headless reviewers on 2× crops in each theme, the turn-end backstop, the setting, the log), T3
   Code's delegation, Claude Code's subagents and CLIs, a `scripts/council` fallback in the skill;
   a stop hook where the harness has one, so the loop isn't skipped (gap p08).
   - Shipped, 2026-11-06 (ADR 0063, amended by 0066): the editor's review loop, a server service
     that at a design turn's end asks the round's review models in read-only sessions, on a
     picture of each page as the editor draws it; Settings › Agents › Review as a review level
     (Off, Quick, Standard, Thorough, Custom) with the review models, kept in
     `ultrapaint.config.json` under `review`; the composer's Review chip for one design; the
     findings log, turned on by Keep findings in the person's profile.
   - Shipped, 2026-11-10: the rendered checks as a package of their own, `packages/design-checks`,
     which the lab's `measure` runs and the editor can.
   - Open: the checks at each edit in the editor's write tools and a script of them in the skill;
     the review's settings as the person's own default; the request's words read into the
     settings; when (End of turn · Each section) as a setting; 2× crops in each theme (see Open);
     the council started by T3 Code's delegation, Claude Code's subagents and the CLIs, the
     `scripts/council` fallback and a stop hook.
6. **Triage** (issue #8), **trim** (issue #9) and **the benchmark** (issue #7), scored the same way.
   - Shipped, 2026-11-06 (ADR 0066): triage, `pnpm evals triage`.
   - Open: trim and the benchmark.

## Open

- Screenshots of a node are 2× only up to 800px wide and in the canvas's theme; the editor's review
  needs a scale and a theme in the request (`contracts/screenshots.ts`).
- Cursor has no agent in the editor; its reviewers run through `cursor-agent`, as in the lab.
