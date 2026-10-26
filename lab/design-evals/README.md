# Design evals

The design skills (`apps/server/src/skills/`) are what every agent is told about designing well
before it designs. This finds what they fail to teach: take a screen someone made well, give an
agent its content and none of its design, let it design the screen in ultrapaint, and compare
the two. What the agent misses in every run is something no skill teaches; what it misses in some
runs is something a skill teaches too weakly to hold.

Internal only: it changes nothing in the product. It runs the `ultrapaint` command from this
checkout as a user would, so a round measures the skills, the briefing and the tools as they are
on the current commit.

## The loop

1. **Collect** a reference: `references/<id>/reference.json` (below).
2. **Capture** it: `capture` takes its pictures at 1440 and 390 wide, the first window and the
   whole page in tiles, and its text in reading order.
3. **Brief** it: `brief` writes its content, without its design, to `brief.md`. Read the brief and
   fix it by hand: it is what the agent gets, every round, so it has to carry all the content and
   no design.
4. **Run a round**: `round <name>` has the agent design every reference from its brief, three
   times each on an empty designs directory; a judge compares each run with its reference; a
   report puts the judgements together.
5. **Read the report** (`runs/<name>/report.md`): scores per skill, and the gaps, most frequent
   first, each with the skill it belongs to and why it happened.
6. **Try a fix**: copy the proposals worth trying from `runs/<name>/proposals/` (or write your
   own) into `candidates/<fix>/`, run `round <name>-<fix> --skills candidates/<fix>`, and
   `compare <name> <name>-<fix>`. What helps goes into the shipped skills later, by hand.

## Commands

From the repository's root:

```sh
node lab/design-evals/src/cli.ts capture [refs…]          # --force to take them again
node lab/design-evals/src/cli.ts brief [refs…]            # --force to write them again
node lab/design-evals/src/cli.ts round <name> [refs…]     # generate + judge + report
node lab/design-evals/src/cli.ts compare <baseline> <candidate>
```

`round` takes `--runs` (3), `--agent` (claude-code), `--agent-model` (the name the agent's model
picker shows; its default otherwise), `--skills candidates/<fix>`, `--minutes` (30, per run),
`--judge-model` (opus) and `--concurrency` (3 judgements at once). It resumes: a run with a
`run.json` and a judged run are kept, so after a failure, run the same command again. Its steps
are also commands of their own: `generate`, `judge` (`--force` to judge again) and `report`.

Needs Chrome (or `LAB_BROWSER`), the `claude` command signed in, and the agent the round uses
signed in too. Every run costs one full agent session, and every judgement one Claude session over
a dozen pictures: start with one reference and `--runs 1`.

## A reference

```json
{
  "kind": "dashboard",
  "name": "shadcn/ui: dashboard block",
  "url": "https://ui.shadcn.com/view/new-york-v4/dashboard-01",
  "why": "What makes it good: what the judge should look at first.",
  "hide": [".cookie-banner"],
  "waitMs": 1500
}
```

Pick screens of every kind the product is used for (landing pages, dashboards, app screens,
settings, forms, empty states), from anywhere: a public site, a prototype, a gallery. Prefer a
page that is the screen alone; a page that frames it (a docs site around an example) puts the
frame in the pictures. A screen behind a login, or only a picture, has no `url`: put its pictures
in `capture/` by hand, under the names `capture` uses (`desktop-fold.jpg`, `desktop-01.jpg`…,
`mobile-fold.jpg`, `mobile-01.jpg`…), and, if there is one, its text in `content.md`.

## What a round leaves

```
runs/<name>/
  round.json            agent, model, commit, which skills
  skills/<skill>.md     the skills as the agents were told them this round
  <ref>/run-<n>/
    shots/              the agent's page, in the same pictures as the reference
    pages/              its page files
    trace.md            its tool calls in order, failures with what they said
    agent.md            what it said at the end
    run.json            calls, tokens, seconds, problems
    judge.json, judge.md
  findings.json, gaps.json
  report.md             scores, gaps, proposals
  proposals/<skill>.md  proposed replacements of the shipped skills
```

Git keeps `round.json`, `report.md`, `gaps.json`, `proposals/` and comparisons; the pictures,
pages and judgements stay on the machine that ran the round.

## How it is judged

The judge reads the brief, every skill, both sets of pictures and the run's trace, and looks for
the places where the agent's design is visibly worse than the reference: the reference is one good
answer, so a different choice that works as well is no finding. Each finding names the skill
whose subject it is, and how that skill covers it:

| Coverage | Means | Fix |
| --- | --- | --- |
| not covered | no skill says it | add the rule |
| covered, not followed | a skill says it, the agent did not do it | make the rule harder to miss: an exact value, a check in "Before you finish" |
| rule misleads | following the skill made it worse | change or remove the rule |
| tool limitation | ultrapaint could not do it | not a skill: a product issue |

Each run is scored 1–5 per skill. The report groups the findings of all runs into gaps and counts
them: seen in every run of a reference, it is consistent; in some, it is flaky. Scores that
disagree by 2 or more between runs of one reference are marked ⚠.

## Where the prototypes are designed

In this repository's own web app, with its components and stylesheet (`HOST` in `src/ultrapaint.ts`),
the setup the agent benchmark in `apps/server/bench` uses. It has no imported design system, so
rules that name tokens meet a project without them. A product with a design system of its own
would test those rules; choosing one is still open.

## Later

How this joins the product (the skills' own tests, CI, a command) waits for the current refactor.
Until then it imports nothing from the server and touches nothing outside `lab/`.
