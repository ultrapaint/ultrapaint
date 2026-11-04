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
| D1 | What starts a review | The designer asks with a review tool when a section is done; if a turn ends with sections edited since their last review, the editor reviews them and sends the findings back into the chat |
| D2 | Who reviews | The person says, the first time a design would be reviewed: which agents, how many passes, on or off by default. Kept as their setting, changed in Settings › Agents |
| D3 | A finding the designer disagrees with | It fixes or declines each one, a decline with its reason |
| D4 | The findings | Every finding, its reviewer and model, the skill version and what the designer did, in a log in the project's state; in this repository a triage skill turns recurring ones into gaps in `evals/gaps/` |
| D5 | When in the loop | Measured first: a review after each section against one at the end of the turn, against none. The editor is built for the one that wins |
| D6 | One skill | The reviewer is the design skill in its review role: the skill gains a short section on reviewing a section, which the lab's recall reviewers read too |

## Phases

1. **The lab experiment (D5).** No product code.
   - A candidate skill: the review role, and steps that expect reviews and answer each finding.
   - `pnpm evals round` gains a review loop: after a turn, it cuts the page into sections, has
     the chosen reviewers review them (the runner recall uses: Claude, Codex, Cursor), sends the
     findings into the thread as the next prompt, and repeats up to the passes. Two timings: at
     the end of the turn, and section by section (the designer ends its turn after each section).
   - What a design is scored by: what a fixed panel of fresh reviewers still finds in the
     finished sections, the fidelity judge beside it, and the time and tokens it took.
   - Three arms on the same three references, two runs each; none is `design-after` (2026-11-04).
2. **The editor.** A `review` MCP tool; a server service that runs reviewers headless and in
   parallel on 2× crops in each theme; the turn-end backstop; the setting and the first-use
   question; the review log. ADR 0060 accepted with the timing measured.
3. **Triage.** A skill in this repository that reads the review logs, groups recurring findings,
   matches them to `evals/gaps/` and drafts new gap files for the person to keep or drop.
4. **The benchmark** (issue #7): every designing agent × skill version, with and without reviews,
   scored as in phase 1.

## Open

- Screenshots of a node are 2× only up to 800px wide and in the canvas's theme; the editor's review
  needs a scale and a theme in the request (`contracts/screenshots.ts`).
- The MCP tool budget has about 800 characters left; a `review` tool costs 350–550.
- Cursor has no agent in the editor; its reviewers run through `cursor-agent`, as in the lab.
