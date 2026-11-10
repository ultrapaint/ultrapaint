# Design evals

The design skills (`skills/ultrapaint/`) are what every agent is told about designing well
before it designs. This finds what they fail to teach: take a screen someone made well, give an
agent its content and none of its design, let it design the screen in Ultrapaint, and compare
the two. What the agent misses in every run is something no skill teaches; what it misses in some
runs is something a skill teaches too weakly to hold.

Internal only: it changes nothing in the product. It runs the `ultrapaint` command of this
checkout as a user would, in a host project (`hosts/` of the data directory), so a round measures
the skills, the briefing and the tools as they are on the checkout's current commit, in a project
with or without a design system. It reaches Ultrapaint through its command and its wire contracts
(`@ultrapaint/contracts`) only, so `pnpm typecheck` says when a change to the contracts breaks it.

## The data directory

The code and its prompts are here; what they read and write is not in git: the references and
their captures, the hosts, the rounds, the studies' corpus. It is `ULTRAPAINT_EVALS_DATA`, else
`~/Code/ultrapaint-data`:

```
hosts/          the projects the agents design in (below)
references/     one directory per reference: reference.json, capture/, brief.md
families/       a product's screens and component crops, for track A
candidates/     skill files to try, at their paths in the skill (recall --skills candidates/<fix>)
gaps/           the design gaps' pictures, and the sections recall reviews (gaps/README.md)
runs/           one directory per round, and <a>-vs-<b>/ for pairwise
corpus/, studies/, patterns/, patterns-landing/, gallery/   the studies' sources and notes
.work/          the servers' configurations, scratch designs directories and logs
```

### Hosts

The projects the agents design in. Each is what a user gets from `ultrapaint new`, so a round
measures the skills in the situation a real project puts them in.

| Host | Made with | Components | Design system |
| --- | --- | --- | --- |
| `blank` | `ultrapaint new <data>/hosts/blank --template blank` | none | none: a theme that declares nothing |
| `starter` | `ultrapaint new <data>/hosts/starter --template starter`, then `pnpm evals setup-host starter` | the starter's ten | imported by Ultrapaint's own `/init`: tokens, text styles, components, `DESIGN.md` |

Every run starts from the host's `designs/`, copied into a scratch `.eval-designs/` beside it, and
the host's `DESIGN.md` is put back after each run, so nothing a run writes stays. The
application's code (`app/`) is the host's, and is not changed by a round. `node scripts/cli.ts`
from the repository's root is the `ultrapaint` command; after copying a host, run `pnpm install`
in its `app/`.

## Two tracks

Remaking a screen asks two things of an agent that are best measured apart:

- **Track A, the design system** (`extract`): given the screens of one product (a *family* of
  references: `family` in `reference.json`), an agent makes a project's design system match
  them, as a user would ask: tokens and components restyled in an implement thread, brought into
  Ultrapaint with `/sync`, then laid out on a sheet at `/components` by a design thread. Each
  component of the sheet is cut out and compared with the same component cut from the family's
  screens (`families/<family>/components/`). A run's project is kept, and the best becomes the
  family's library: `freeze <family> <round> <run>` copies it to `hosts/<family>`.
- **Track B, the composition** (`round --host family`): each reference is designed on its
  family's library, several runs each, so what is measured is the layout, the words and the
  data, not a design system the agent had to invent.

Both are reviewed best of several: the same component, or the same section, from every run,
lettered A, B, C in a shuffled order beside the reference; you pick the best, or none, with a
comment when there is something to say. `learn <round>` then reads your picks: what the winners do
that the others do not, as rules for the skills (`runs/<round>/learned.md`).

```sh
pnpm evals extract <round> [families…] --runs 3        # track A
pnpm evals freeze <family> <round> <run>               # its best run, the family's library
pnpm evals round <round> --host family --runs 3        # track B
pnpm evals review <round>                              # pick the best of each
pnpm evals learn <round>                               # what the picks say
```

## The loop

1. **Collect** a reference: `references/<id>/reference.json` (below).
2. **Capture** it: `capture` takes its pictures at 1440 and 390 wide, the first window and the
   whole page in tiles, and its text in reading order.
3. **Brief** it: `brief` writes its content, without its design, to `brief.md`. Read the brief and
   fix it by hand: it is what the agent gets, every round, so it has to carry all the content and
   no design.
4. **Run a round**: `round <name> --host <host>` has the agent design every reference from its
   brief, three times each, in the host project, each time from the host's designs as committed;
   a judge compares each run with its reference; a report puts the judgements together.
5. **Review it yourself**: `review <name> [<other round>…]` opens a viewer in the browser (on a
   phone too: `--host <tailscale address>`) where you swipe through cards, the quickest first:
   the layout alone (blurred and grey, nothing to read), one section at a time (the sidebar, the
   key figures, the table) beside the same section of the reference, whole designs, the judge's
   findings (real problem or not), and every text the agent added (needed or noise). With two
   rounds, designs are compared side by side, sides hidden. A comment is optional. Your verdicts overrule the judge in the report,
   and your comments are the synthesis's first evidence.
6. **Read the report** (`runs/<name>/report.md`): scores per level of design, how much the agents
   added that should not be there, and the gaps, most frequent first, each with its level, the
   skill it belongs to and why it happened. Run `report` again after a review.
7. **Try a fix**: write the change into the skill of a worktree of its own (below, "A candidate
   in a round"), run `round <name>-<fix> --host <host>` from it, and `compare <name>
   <name>-<fix>`. What helps goes into the shipped skill later, by hand.

The same references in two hosts, compared, say what a design system changes: which gaps it
closes, and which rules only hold with tokens to hold them.

## Commands

From the repository's root:

```sh
pnpm evals capture [refs…]                     # --force to take them again
pnpm evals brief [refs…]                       # --force to write them again
pnpm evals round <name> [refs…] --host <host>  # generate + judge + report
pnpm evals sections <name> [rounds…]           # cut designs into sections (round does it)
pnpm evals review <name> [rounds…]             # swipe through it in the browser
pnpm evals compare <baseline> <candidate>
pnpm evals pairwise <a> <b>                    # the two judged blind, run by run
pnpm evals setup-host <host>                   # import a host's design system with /init
pnpm evals panel <round> [rounds…]             # what a fixed panel still finds in the designs
```

`pairwise` judges each run twice, the two designs shown the other way round the second time: a
judge leans to one letter, so a side that changes with the order counts as a tie, and the command
ends on how many winners changed (the judge's flip rate). `--one-order` judges once; a run judged
once before is asked only the order it lacks.

`round` takes `--runs` (3), `--agent` (claude-code), `--agent-model` (the name the agent's model
picker shows; its default otherwise), `--minutes` (30, per run),
`--judge-model` (opus) and `--concurrency` (3 judgements at once), and the review loop's
`--review end|each-section` (none by default), `--reviewers` (opus), its goal (`--goal`,
`--reviewer-goals`, `--floors`, `--max-rounds` (6), `--budget`), `--log-findings` and `--effort`
(high), below. It resumes: a run with a
`run.json` and a judged run are kept, so after a failure, run the same command again. Its steps
are also commands of their own: `generate`, `judge` (`--force` to judge again) and `report`.

Rounds measure the checkout the command runs from. To measure another commit (the skills before a
change, to compare with after), make a worktree of it, install it, and point
`ULTRAPAINT_CHECKOUT` at it; say which in the round's name:

```sh
git worktree add ../before <commit> && pnpm -C ../before install
ULTRAPAINT_CHECKOUT=../before pnpm evals round before-<name> --host blank --runs 1
```

Work going on in the checkout changes a round half way (it did once: four commits landed during
two rounds), so run rounds from a worktree that stays put. `LAB_EDITOR_LOG=1` prints the editor's
console errors, which say why a picture could not be drawn.

Needs Chrome (or `LAB_BROWSER`), the `claude` command signed in, and the agent the round uses
signed in too. Run rounds one at a time: when the checkout has moved since its editor was last
built, `ultrapaint` rebuilds it as it starts, and two rounds starting at once collide. Every run costs one full agent session, and every judgement one Claude session over
a dozen pictures: start with one reference and `--runs 1`.

## Reviews in a round

ADR 0060 has a council of reviewers look at a design inside its loop, each scoring it out of 100,
until the goal says to stop. Whether they do it section by section or once at the end of the
designer's turn is measured here first (`docs/plans/PLAN-review-loop.md`):

```sh
pnpm evals round <name> --host family --review end --reviewers opus,gpt-6.1-sol --goal 90
pnpm evals round <name> --host family --review end --reviewers opus,cursor:grok-4.7-high  # until both sign off
pnpm evals panel <name> design-after --models opus,gpt-6.1-sol,cursor:grok-4.7-high
```

- **The council** is `--reviewers`. Each reviewer only looks (Claude with `Read,Glob`, Codex in
  its read-only sandbox, Cursor in ask mode) and answers, per section, its findings (each with
  its category, one of the skill's references, its severity and the rule it breaks, or none), the
  categories the section has, and a sign-off: good enough for what was asked, or what is left.
- **Its score** (contracts' `review`): a category is 100 less its findings' cost (blocker 40, major
  15, minor 5, nit 1), a section the mean of its categories (60 at most with a blocker), the page
  the mean of its sections. Each reviewer is scored on its own findings; the council has no score
  of its own. A reviewer that fails has no score that round, and the loop goes on with the others.
- **Who looks** (ADR 0061): `--each-round` (`rotate` by default: the members in turn; `one`, the
  first; `all`, the whole council) and `--sign-off` (`all` by default: once a round's reviewers
  are satisfied, the whole council reviews the page as it stands and decides; `one`, the round's
  own reviewers close the loop). Each pass records who reviewed it, and whether it signed off.
- **The goal**: with `--goal <score>`, the loop stops when every reviewer reaches it;
  `--reviewer-goals gpt-6.1-sol=none,cursor:grok-4.7-high=80` gives one its own target or makes it
  only advise; `--floors accessibility=80` holds every reviewer to a category's floor. Without
  `--goal`, it stops when every reviewer signs off. `--max-rounds` (6), two rounds gaining under 2
  points, and `--budget` (dollars, where the models say) stop a loop that isn't converging; the
  last pass records why it stopped and which pass was best. A pass that finds nothing stops it too.
- **The findings log** (`--log-findings`, off by default): every pass's findings are appended to
  `~/.ultrapaint/findings/lab.jsonl` (`ULTRAPAINT_FINDINGS` for another directory), each with its
  project (`lab/<round>`), page, section, crop, reviewers, the skill's commit and what the
  designer did with it, for triage (issue #8).

- `--review end`: when the designer's turn ends, its page is cut into the reference's sections,
  every reviewer (models as `recall --models` takes them) reviews every section from its crop with
  the skill of the checkout under test (`runs/<round>/review-skill/`), the judge model groups the
  reviewers' findings per section, and they go back into the same thread as the next prompt
  (`prompts/review-findings.md`) with each reviewer's score and what it has left: fix each, or
  decline it with a reason. Again, until the goal says to stop.
- A reviewer reviews within what the designer was asked (`prompts/review-request.md`): the
  brief's text, its content used as written, the round's pictures (with `--picture`) deciding the
  look and shown to the reviewer, and the components the design system's. It reports only what
  the designer can change within that; what only a design-system component would fix comes back
  as `systemNotes`, kept in `review.json` and shown to the designer after the findings as notes,
  unnumbered and not answered.
- `--review each-section`: the first prompt also asks for one section per turn, each ending on
  `Section done: <node> <name>` (`prompts/review-each-section.md`). That node is pictured and
  reviewed until the goal says to stop, before the designer is asked for the next; after `All
  sections done`, the page is reviewed as in `end`. Forty turns at most.
- Each run keeps `review.json` beside `run.json`: every pass with its sections, each reviewer's
  findings, score and sign-off, the merged list, why the loop stopped, the designer's reply and which numbers it fixed or declined, and the
  totals with and without the review work (the designer's own turns, its answers, the reviewers).
  `run.json` counts all the designer's turns.

`panel` scores finished designs, a review round's or any other (`design-after` is the no-review
baseline), by what a fixed panel of fresh reviewers still finds: every model of `--models` reviews
every section of each run's final page with the skill of the checkout the command runs from,
within the run's request as above (the round's `round.json` says whether it had pictures), the
judge model groups their findings, and fewer problems is better; system notes are counted apart.
Each panel model also scores each run out of 100 on its own findings, as the council does. Each
run gets `panel.json`, kept while the panel is the same (a run with no sections to show is not
reviewed, and is in neither file), and the round `panel.md`: problems per
run and per section, each model's score, beside the judge's overall score and the run's seconds
and tokens.

### A candidate in a round

A round's agents are told the skill the way a project is: by the server, which carries the skill
it was built with (`design.generated.ts`) and takes no skill from the host. So a round has no
`--skills`: a candidate is the whole skill, `skills/ultrapaint/`, in a worktree of its own, written
into its server and measured by `ULTRAPAINT_CHECKOUT`:

```sh
git worktree add ../fix-<fix> && pnpm -C ../fix-<fix> install
cp -r <the candidate's files> ../fix-<fix>/skills/ultrapaint/   # at their paths in the skill
pnpm -C ../fix-<fix> -F @ultrapaint/server skills
ULTRAPAINT_CHECKOUT=../fix-<fix> pnpm evals round <name>-<fix> --host <host>
```

The round's reviewers and the panel read the same checkout's skill. `recall` needs no worktree: it
reads the skill as files, and lays `candidates/<fix>/` over the checkout's (below).

### Outside the editor

A host with a `host.json` of kind `outside` is a plain app, not an Ultrapaint project (`hosts/plain`:
React, Vite, Tailwind). A round there measures the skill where nobody tells an agent about it:

```sh
pnpm evals round <name> [refs…] --host plain --agent codex --agent-model gpt-6.1-sol
pnpm evals round <name>-none [refs…] --host plain --agent codex --agent-model gpt-6.1-sol --skill none
pnpm evals pairwise <name>-none <name>
```

```json
{ "kind": "outside", "entry": "src/App.tsx", "modules": "../blank/app/node_modules" }
```

Each run copies the host's app into `.work/outside/<round>/<reference>/run-<n>`, links the
installed packages `modules` names (from the host's directory), installs the skill as a project
does, in `.agents/skills/ultrapaint/` and `.claude/skills/ultrapaint/`, and runs the agent's own
command there with the reference's brief (`prompts/generate-outside.md`), which never names the
skill: `codex exec` for `--agent codex`, `claude -p` with the project's settings alone for
`claude-code` (the default). `--agent-model` is the name that command takes (`gpt-6.1-sol`,
`opus`). `--skill` is `built-in` (the checkout's), `candidates/<fix>` laid over it, or `none` for
the baseline; a round keeps the one it started with.

The run is written where an editor round's is (`shots/` from the app's own dev server, `pages/`
its source, `trace.md`, `agent.md`, `run.json`, and the agent's events as they came in
`events.jsonl`), so `judge`, `panel`, `pairwise` and `review` read it as any run, and the skill's
files a run opened are counted from the installed path. The agent and the dev server are stopped
with their process group, at `--minutes` too. Run a bulk round under `.work/probe/lab-guard.mjs`.

## Gaps and recall

The design skill's known gaps are files in `gaps/` (`pnpm evals gaps` lists them): what a
person found wrong in a design made with the skill, and what the lab tried. [`gaps/README.md`](gaps/README.md)
says how to add one. `recall` measures a fix for them: a fresh reviewer, told one version of the
skill, reviews each gap's section from its pictures and code; a judge blind to the version
matches the review with the person's findings; what no gap matches is grouped for the person
to rate.

```sh
pnpm evals gaps
pnpm evals recall <round> --skills built-in,candidates/<fix> [sections…]
```

A version is `built-in`, the checkout's `skills/ultrapaint/`, or `candidates/<fix>`: its files
laid over the checkout's at their paths in the skill (`SKILL.md`, `references/kinds/dialog.md`),
the rest as shipped. It takes `--runs` (3: under three, one gap's count says little), `--effort`
(high) and resumes like a round. It writes `runs/<round>/report.md` and each measured gap's line
under **Result.**

The report says how far its counts go. Under **How far the counts go**, each version has what it
caught, what it caught or partly caught, the 95% interval of its recall and its difference from
the first version with an interval of its own: both come from resampling the gaps, since a gap's
runs go together, and a difference whose interval holds 0 is one the round does not show. The
gaps that are not `done` are counted apart: a `done` gap's rule was written from the section it is
measured on, so the others are the held-out split a change has to show on. Give `--judge-model` a
model that does not review: the report says so when the judge read its own reviews. Or give it
several (`--judge-model opus,gpt-6.1-sol,cursor:grok-4.7-high`): each judges every review, a gap's
verdict is the one most of them gave, the first groups what no gap matched, and the report says
what each judge counted alone and how often they agreed.

What no gap matched is counted per review and version, in every section and in the held-out
ones. `--rate` writes the deck `rate-<round>` of the held-out sections' problems, shown without
the version that found them; after `pnpm evals decide rate-<round>`, the same `recall` command
writes the report again with each version's share of real ones among what was rated.

### Triage: gaps from what reviews find

While the person keeps findings (Settings › Preferences › Keep findings), every review of a
design appends its findings to `~/.ultrapaint/findings/<project>.jsonl` (ADR 0066). `triage`
turns the recurring ones into gaps:

```sh
pnpm evals triage <name>            # group, check, draft; then answer the deck it names
pnpm evals decide triage-<name>     # keep or drop each draft
pnpm evals triage <name> --apply    # write what was kept into gaps/
```

It reads the findings logged since the last applied triage (`--all` for every one), and groups
them category by category into problems (`--grouper`, gpt-6.1-sol). A problem found in two designs
or by two review models (`--min-designs`, `--min-models`), and not mostly declined by its
designers, is checked by models on two providers (`--models`, `opus,gpt-6.1-sol`) against the
skill and the gaps: whether it is real and general, a rule the skill lacks (`missing`) or has
(`missed`), and whether a gap covers it already. What they all find real and general is drafted:
a new gap, or a line of evidence for the gap that covers it. The run keeps its groups and checks
in `triage/<name>/` of the data directory and resumes; nothing reaches `gaps/` until `--apply`.

The editor's review models open no file (ADR 0063). `--inputs untold,told` reviews as they do,
from the pictures and code with no skill to open: `untold` with no rules, as they are today, and
`told` with the core's rules and the version's review table (`references/review.md`, when it has
one) in the prompt. Their difference is what giving those models the rules is worth:

```sh
pnpm evals recall <round> --skills candidates/review-table --inputs untold,told --models opus,gpt-6.1-sol
```

To compare models as reviewers, give several to `--models` (opus by default): each reviews with
every version of the skill, as a version of its own (`shipped@gpt-6.1-sol`), and one model judges
them all, blind to who reviewed (`--judge-model`, opus). A `gpt-` or `o<digit>` model runs in Codex, and any of
Cursor's in `cursor-agent` by its exact name after `cursor:` (`cursor-agent --list-models`):

```sh
pnpm evals recall <round> --models opus,gpt-6.1-sol,cursor:grok-4.7-high --runs 2
```

Cursor bills its named models (Opus, Gemini) from one pool and Composer and Grok from another;
each run on it is guarded by `.work/probe/cursor-guard.mjs <pgid> 98 auto|api`, which stops it
before the pool runs out or anything is billed on demand.

A round's designing agent is chosen the same way: `round --agent codex --agent-model
gpt-6.1-sol`, compared with `compare` or `pairwise`.

What no wording made a reviewer see can be measured instead, on a rendered page:

```sh
pnpm evals measure <url> [--steps steps.mjs] [--root <selector>] [--ratio 2] [--out findings.json]
```

It flags stacked groups set less than `--ratio` times the gap between the lines of the group
below apart (a single line closer to what follows is its heading), and dividers off their bar's
line by more than 1.5px. The steps file is `export default [async (page) => {}]`, run before
measuring.

`--checks` adds the general design checks (ADR 0061), each with a threshold from the skill or the
design system: text and placeholder contrast (4.5:1, large 3:1), a field's edge against what it
sits on (3:1), a filled control whose fill doesn't separate (under 1.1:1), surfaces nearly one
tone (under 0.045 oklch lightness apart, `surfaces.md`'s step; or on a floating card's own tone), a dialog darker than
the page it covers, rounded or filled rows touching, text clipped with no ellipsis, and targets
under 24×24. `--hover` checks again with every control drawn as hovered (Chrome's forced
`:hover`), for fills that touch and controls shown only on hover; `--stress` lengthens a name in
each list (three or more rows of one height) to see whether it truncates; `--grid 4` checks
computed spacing against a scale, off by default since a page's half steps look like values off
it. `runs/checks-1/` and `checks-2/` hold them run on the editor before and after its fixes.

The checks are the package `@ultrapaint/design-checks` (`packages/design-checks`): what runs in
the page (`in-page.ts`) and the findings made from what it read (`findings.ts`), pure and free
of the lab, so the editor can run them on a frame it draws. `--axe` adds axe-core's contrast and
target-size rules beside them, each with the ratio or the size it measured: a second opinion on
ours, and a dependency of the lab alone (MPL-2.0). Where axe cannot tell (a gradient or an image
behind the text) its finding is marked to confirm. Its target rule passes a small target with
24px of room around it, as WCAG does; ours asks for the 24×24 itself, as the skill does.

```sh
pnpm evals off-system <rounds…>
```

`off-system` counts, per run, the values a round's pages set for themselves where the design
system has a token (design-document's `offSystemValues`), into `runs/<round>/off-system.md`.

### How a finding could have been caught

```sh
pnpm evals catchable <name> --decks held-out-rest --panels design-after   # gpt-6.1-sol, medium
pnpm evals outline [sections…]                                            # each section's outline.md
pnpm evals recall <round> --models gpt-6.1-sol --inputs pictures,outline
```

`catchable` sorts every finding held (the gaps, a deck's findings answered real, a round's panel
findings) by the cheapest way it could have been caught: `code` (a general check, written once for
every screen), `outline` (a text outline of the sections, words, actions and states, written
before drawing) or `eye`. Its report counts them per source and names the checks by how much
each would catch. `outline` writes each gap section's outline from its code, with no look and no
judgement, and `recall --inputs outline` shows a reviewer that outline instead of the pictures and
code (`shipped+outline`), to see which gaps the outline alone shows. Its report ends with what a review took on
average, per version: findings, seconds and, where the model counts them, tokens.

## Decisions

When an agent needs several decisions from the person, it writes them as a deck and the person
answers in the browser, one card at a time: a number key answers and moves on, and the answers
are saved as they are given. When no option fits, the person writes their own answer and sends it
(⌘/Ctrl+Enter); words written before a number key go with that option as a comment. The page follows the system's light or dark theme; its header's
switch (or T) sets one, kept in that browser.

```sh
pnpm evals decide <deck> [--host <tailscale address>]   # decisions/<deck>.json in the data directory
```

A deck is `{ title, intro?, cards }`. Each card has:

- `id`, `title`, an `eyebrow?` and a `body?` in markdown;
- `pictures?`: `{ src, caption, marks? }`, with `src` a path from the data directory. `marks`
  are boxes drawn around what the card asks about, `{ x, y, width, height, label?, at? }` in
  fractions of the picture, the label `above`, `below`, `right` or `inside` it;
- `options`: `{ key, label, leads? }`, where `leads` says what choosing it leads to;
- `recommend?`: an option's key.

The answers land in `decisions/<deck>.answers.json`, each with its label, the card's title and
any comment, for the agent to read back and act on. An answer in the person's own words has no
`choice`, the label "Own answer", and the words as its comment: read it as the decision. Ask the decision itself, with what each
answer leads to and the evidence beside it, and put the quickest cards first. Show each item as
a close-up with a box around it, never a whole screen to search. An item that no picture shows
says so on its card.

## A reference

A shot from a gallery (Dribbble…) is a reference too: `image` is the picture's URL, `capture`
downloads it as the desktop first window and cuts its parts, enlarged, into `zoom-*.jpg` so its
small text can be read. A shot shows one viewport, so `viewports` says which, and the agent
designs for that one only. The brief's writer and the judge are told to look past the shot's
backdrop, window or device, and not to complete what it cuts off.

```json
{
  "image": "https://cdn.dribbble.com/userupload/…/file/….jpg",
  "kind": "app",
  "name": "Untitled UI: notification settings",
  "source": "https://dribbble.com/shots/…",
  "viewports": ["desktop"],
  "why": "What makes it good: what the judge should look at first."
}
```

A site:

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
    review.json, review/  the review loop's passes and their pictures, with --review
    panel.json          what the panel found, after `panel`
    added-text.json     texts the page shows that the brief did not have
    parts/              each of them in its place
    judge.json, judge.md
  findings.json, gaps.json, unwanted-text.json
  review.json           your verdicts, card by card
  review-notes.md       your comments
  report.md             scores, less is more, gaps, proposals
  panel.md              what the panel found, run by run and section by section
  proposals/<skill>.md  proposed replacements of the shipped skills
```

All of it is in the data directory, on the machine that ran the round.

## How a run is done

The agent gets the prompt in `prompts/generate.md` with the brief in it, in a design thread of
its own, as a user would type it. Nobody is there to click, so every tool call it asks permission
for is allowed, and every question it asks gets its first option.

Its page is then drawn at each viewport, through the same `set_frame` and `get_screenshot` the
agent has: the first window at the window's height, then the whole page, the frame growing until
the content ends. A page drawn to the window's height (a full-height layout) is its first window.
A viewport is drawn from the variant made for it, `<page>@mobile`, when the agent made one.

## How it is judged

The judge reads the principles (`prompts/principles.md`: less is more first), the brief, every
skill, both sets of pictures and the run's trace, and looks for the places where the agent's
design is visibly worse than the reference: the reference is one good answer, so a different
choice that works as well is no finding. Each finding is at one level of design:

| Level | Looks at |
| --- | --- |
| layout | regions, proportions, grid, alignment, use of space, what breaks |
| hierarchy | what is primary, order and grouping of content and data, how it scans |
| components | the right control for each job, consistency, the design system's own |
| restraint | less is more: labels, descriptions, headings, icons, boxes the screen does not need |
| typography, color, spacing | scale and weight, palette and contrast, rhythm and density |
| craft | icons, radii, number formats, states, wording, alignment to the pixel |

and names the skill whose subject it is, and how that skill covers it:

| Coverage | Means | Fix |
| --- | --- | --- |
| not covered | no skill says it | add the rule |
| covered, not followed | a skill says it, the agent did not do it | make the rule harder to miss: an exact value, a check in "Before you finish" |
| rule misleads | following the skill made it worse | change or remove the rule |
| tool limitation | Ultrapaint could not do it | not a skill: a product issue |

The tool limitations are a by-product worth reading: they are what the editor lacks for designs
like the reference's.

Each run is scored 1–5 per level. The report groups the findings of all runs into gaps and counts
them: seen in every run of a reference, it is consistent; in some, it is flaky. Scores that
disagree by 2 or more between runs of one reference are marked ⚠.

### Less is more, counted

After a run, every text its page shows is matched against the brief's content (its lists, tables
and quoted copy, not the brief writer's own words): what is left is what the agent wrote itself.
Each is pictured in its place (`parts/`), and the judge says of each whether it is noise, invented
content, or needed. The report counts the noise and the invented per run; `compare` says whether
a change to the skills made it go down. Your verdict on a text card overrules the judge's.

`prompts/principles.md` is where taste is written down. Add to it what your review comments
keep saying: it goes to the judge and to the synthesis of every round.
