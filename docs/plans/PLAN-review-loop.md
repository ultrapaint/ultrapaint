# Plan: designs reviewed inside their loop, by reviewers the person picks

Status: proposed, 2026-11-04. Decision in ADR 0060. Builds on 0059 (gaps measured by recall).

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
| D8 | When to stop | A score asked holds every reviewer to it (own targets, advisory reviewers and category floors optional); none asked, every reviewer signs off. Caps: 6 rounds, 2 rounds under 2 points of gain, budget; the best round is kept |

## Phases

1. **The lab** (2026-11-04, on main): `pnpm evals round --review end|each-section --reviewers …`
   with `--goal`, `--reviewer-goals`, `--floors`, `--max-rounds`, `--budget` and
   `--log-findings`; `panel` scores each model 0–100. Smoke on one screen, one run each: no review
   left 27–32 problems, one review at the end 20, section by section 12, at 2× and 5× the time.
2. **The experiment, after the 7-day quota resets (2026-11-09).** The council loop (Opus, GPT-6.1-Sol,
   Grok 4.7) until sign-off, at the end of the turn against section by section, Claude and Codex
   designing, three references; scored by the panel and `measure`. Before it, with no new runs:
   whether a council finds more than one model twice, from `recall --models`' runs.
3. **The skill.** Its review role (categories, severity, rule, sign-off, read-only) and the
   step that answers reviews, shipped when phase 2 shows the loop helps.
4. **Harnesses.** Where the designer runs, the council is started: the editor (a server service,
   headless reviewers on 2× crops in each theme, the turn-end backstop, the setting, the log), T3
   Code's delegation, Claude Code's subagents and CLIs, a `scripts/council` fallback in the skill;
   a stop hook where the harness has one, so the loop isn't skipped (gap p08).
5. **Triage** (issue #8), **trim** (issue #9) and **the benchmark** (issue #7), scored the same way.

## Open

- Screenshots of a node are 2× only up to 800px wide and in the canvas's theme; the editor's review
  needs a scale and a theme in the request (`contracts/screenshots.ts`).
- Cursor has no agent in the editor; its reviewers run through `cursor-agent`, as in the lab.
