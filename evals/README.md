# Design evals

The design skill (`skills/ultrapaint/`, a core and its references, ADR 0069) is what every agent
is told about designing well before it designs. This finds what it fails to teach: take a screen
someone made well, give an agent its content and none of its design, let it design the screen in
Ultrapaint, and compare the two. What the agent misses in every run is something the skill does
not teach; what it misses in some runs is something it teaches too weakly to hold.

Internal only: it changes nothing in the product. It runs the `ultrapaint` command of this
checkout as a user would, in a host project (`hosts/` of the data directory), so a round measures
the skill, the briefing and the tools as they are on the checkout's current commit, in a project
with or without a design system. It reaches Ultrapaint through its command and its wire contracts
(`@ultrapaint/contracts`) only, so `pnpm typecheck` says when a change to the contracts breaks it.

## The data directory

The code, its prompts and the pages its viewers serve (`viewers/`: `review`, `gallery`, `decide`)
are here; what they read and write is not in git: the references and their captures, the hosts,
the rounds, the studies' corpus. It is `ULTRAPAINT_EVALS_DATA`, else
`~/Code/ultrapaint-data`:

```
hosts/          the projects the agents design in (below)
references/     one directory per reference: reference.json, capture/, brief.md
families/       a product's screens and component crops, for track A
candidates/     skill files to try, at their paths in the skill (recall --skills candidates/<fix>)
gaps/           the design gaps' pictures, and the sections recall reviews (gaps/README.md)
runs/           one directory per round, and <a>-vs-<b>/ for pairwise
decisions/      the decks an agent asks the person, and their answers
triage/         one directory per triage of the findings log
corpus/, studies/, patterns/, patterns-landing/, gallery/   the studies' sources and notes
.work/          the servers' configurations, scratch designs directories and logs
```

### Hosts

The projects the agents design in. Each is what a user gets from `ultrapaint new`, so a round
measures the skill in the situation a real project puts it in.

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
  screens (`families/<family>/components/`): by you in `review`, and by a model with
  `judge-components <round>`, which scores how close each is and lists what differs
  (`runs/<round>/components-report.md`; `--against <earlier round>` also sets each beside the
  version you picked there). A run's project is kept, and the best becomes the family's library:
  `freeze <family> <round> <run>` copies it to `hosts/<family>`.
- **Track B, the composition** (`round --host family`): each reference is designed on its
  family's library, several runs each, so what is measured is the layout, the words and the
  data, not a design system the agent had to invent.

Both are reviewed best of several: the same component, or the same section, from every run,
lettered A, B, C in a shuffled order beside the reference; you pick the best, or none, with a
comment when there is something to say. `learn <round>` then reads your picks: what the winners do
that the others do not, as rules for the skill (`runs/<round>/learned.md`).

```sh
pnpm evals extract <round> [families…] --runs 3        # track A
pnpm evals judge-components <round>                    # its components against the product's
pnpm evals freeze <family> <round> <run>               # its best run, the family's library
pnpm evals round <round> --host family --runs 3        # track B
pnpm evals review <round>                              # pick the best of each
pnpm evals learn <round>                               # what the picks say
```

## The loop

1. **Collect** a reference: `references/<id>/reference.json` (below). `gallery` shows the shots
   gathered in `gallery/shots.json` one at a time, to take or skip; the ones taken
   (`gallery/selection.json`) are those to make references from.
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
   file of the skill it belongs to and why it happened. Run `report` again after a review.
7. **Try a fix**: a change to the skill starts as a gap (ADR 0065), so the report drafts each
   gap seen in two runs or more as a file for `gaps/` (`runs/<name>/proposals/`); move the ones
   worth keeping there. To try a change, write it into the skill of a worktree of its own
   (below, "A candidate in a round"), run `round <name>-<fix> --host <host>` from it, and
   `compare <name> <name>-<fix>`. What helps goes into the shipped skill later, by hand, naming
   the gaps it closes.

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
pnpm evals gallery [--set shots|shadcn]        # choose the shots to take references from
pnpm evals patterns annotate|book              # how a well-made product builds its interface
pnpm evals study annotate|book                 # what a library of well-made sites does
```

`pnpm evals --help` lists every command, and `pnpm evals <command> --help` its options.

`pairwise` judges each run twice, the two designs shown the other way round the second time: a
judge leans to one letter, so a side that changes with the order counts as a tie, and the command
ends on how many winners changed (the judge's flip rate). `--one-order` judges once; a run judged
once before is asked only the order it lacks.

`round` takes `--runs` (3), `--agent` (claude-code), `--agent-model` (the name the agent's model
picker shows; its default otherwise), `--minutes` (30, per run),
`--judge-model` (opus) and `--concurrency` (3 judgements at once), and the review loop's
`--review end|each-section|editor` (none by default), `--reviewers` (opus), its goal (`--goal`,
`--reviewer-goals`, `--floors`, `--max-rounds` (2), `--budget`), `--log-findings` and `--effort`
(high), below. It resumes: a run with a
`run.json` and a judged run are kept, so after a failure, run the same command again. Its steps
are also commands of their own: `generate`, `judge` (`--force` to judge again) and `report`.

Rounds measure the checkout the command runs from. To measure another commit (the skill before a
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

### Long jobs

A bulk round runs for hours, past any agent's turn, so it runs as a systemd user job under
`.work/probe/lab-guard.mjs`, which stops it when a quota nears its end. When the job ends, systemd
sends the thread that started it a message, whatever its agent, and the thread picks up from
there. From the data directory, with the round's commands in `.work/probe/<name>.sh`:

```sh
export XDG_RUNTIME_DIR=/run/user/$(id -u)  # agent shells lack it; systemctl --user needs it
systemd-run --user --collect --unit=lab-<name> \
  --working-directory="$HOME/Code/ultrapaint-data" \
  --setenv=PATH --setenv=CODEX=80 --setenv=CLAUDE=80 \
  -p "ExecStopPost=$(command -v t3) thread send ${T3CODE_THREAD_ID:?not in a T3 thread} 'lab-<name> ended: journalctl --user -u lab-<name> -n 5 says how (status=75: the guard stopped it at a quota). Logs: .work/<name>.log, .work/<name>-guard.log'" \
  node .work/probe/lab-guard.mjs <name> .work/probe/<name>.sh
```

The shell fills in the thread and the path to `t3` when it starts the job, so the end hook holds no
`$` and no `%`: systemd expands both, and a `$$` in a job's command comes back from a
`daemon-reload` as the shell's pid. The guard reads every quota: a job that runs only Claude takes
`--setenv=CODEX=101 --setenv=CURSOR=101`, or Codex's or Cursor's own window stops it at its start.
The job has no timeout and outlives the agent's session, a restart of T3 Code and a logout. The
guard exits with the round's own code, or 75 when it stopped the round, and says why in its log.
`systemctl --user list-units 'lab-*'` lists the jobs running, `journalctl --user -u lab-<name>` has
what the guard printed and how it exited, and `systemctl --user stop lab-<name>` stops one with
everything it started.

## Reviews in a round

ADR 0060 has review models look at a design inside its loop, each scoring it out of 100, until
the goal says to stop. Whether they do it section by section or once at the end of the
designer's turn is measured here first (`docs/plans/PLAN-review-loop.md`):

```sh
pnpm evals round <name> --host family --review end --reviewers opus,gpt-6.1-sol --goal 90
pnpm evals round <name> --host family --review end --reviewers opus,cursor:grok-4.7-high  # until both approve
pnpm evals panel <name> design-after --models opus,gpt-6.1-sol,cursor:grok-4.7-high
```

- **The review models** are `--reviewers`, in the order they take turns. Each only looks (Claude
  with `Read,Glob`, Codex in its read-only sandbox, Cursor in ask mode) and answers, per section,
  its findings (each with its category, a concern the skill holds rules for, its severity and
  the rule it breaks, or none), the categories the section has, and its sign-off: it approves
  the section as good enough for what was asked, or says what is left.
- **What a review rests on** is in its answer too, in the lab before the editor (the person's
  choice of 10 November). `picture`: whether the capture can be judged; a review of a blank or
  half-drawn one is no review, and the reviewer has no score there. `coverage`: a row per
  concern the section has (passed, findings, or not reviewed and why); a concern it gave no row
  counts as not reviewed, and each pass of `review.json` holds how many concerns were looked at.
  `keep`: one thing the section does well, told to the designer with the findings so a fix
  doesn't sand it down. And a sign-off approves only when none of the reviewer's own findings is
  a blocker or a major: approval is taken from the findings.
- **Its score** (contracts' `review`): a category is 100 less its findings' cost (blocker 40, major
  15, minor 5, nit 1), a section the mean of its categories (60 at most with a blocker), the page
  the mean of its sections. Each review model is scored on its own findings; together they have
  no score. One that fails has no score that round, and the loop goes on with the others.
- **Who looks** (ADR 0061): `--each-round` (`rotate` by default: the review models in turn;
  `one`, the first; `all`, every one) and `--sign-off`, who must approve at the end (`all` by
  default: once a round's reviewers approve, every review model reviews the page as it stands
  and decides; `one`, the round's own reviewers close the loop). Each pass records who reviewed
  it, and whether it approved.
- **The goal**: with `--goal <score>`, the loop stops when every review model reaches it;
  `--reviewer-goals gpt-6.1-sol=none,cursor:grok-4.7-high=80` gives one its own target or makes it
  only advise; `--floors accessibility=80` holds every one to a category's floor. Without
  `--goal`, it stops when every one approves. `--max-rounds` (2 by default, the rounds the
  editor's review ships with, ADR 0063: a first look and a second), two rounds gaining under 2
  points, and `--budget` (dollars, where the models say) stop a loop that isn't converging; the
  last pass records why it stopped and which pass was best. A pass that finds nothing stops it too.
- **The findings log** (`--log-findings`, off by default): every pass's findings are appended to
  `~/.ultrapaint/findings/lab.jsonl` (`ULTRAPAINT_FINDINGS` for another directory), each with its
  project (`lab/<round>`), page, section, crop, reviewers, the skill's commit and what the
  designer did with it, for triage (issue #8). With `--review editor` the log is the editor's
  own (ADR 0066): the flag has its server keep each round's findings in
  `~/.ultrapaint/findings/<the host project's name>.jsonl`, in the user directory whatever
  `ULTRAPAINT_FINDINGS` says.

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
- `--review editor`: the editor's own review loop (ADR 0063) in place of the lab's. The round's
  project is given `--reviewers`, `--each-round`, `--sign-off` and the goal as its review
  settings, the editor reviews each design as it does for a person, and a run keeps the review
  rounds of its transcript in `editor-review.json`.
- Each run keeps `review.json` beside `run.json`: every pass with its sections, each reviewer's
  findings, score and sign-off, the merged list, why the loop stopped, the designer's reply and which numbers it fixed or declined, and the
  totals with and without the review work (the designer's own turns, its answers, the reviewers).
  `run.json` counts all the designer's turns.

`panel` scores finished designs, a review round's or any other (`design-after` is the no-review
baseline), by what a fixed panel of fresh reviewers still finds: every model of `--models` reviews
every section of each run's final page with the skill of the checkout the command runs from,
within the run's request as above (the round's `round.json` says whether it had pictures), the
judge model groups their findings, and fewer problems is better; system notes are counted apart.
Each panel model also scores each run out of 100 on its own findings, as a round's review models do. Each
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

The marks a model gives a public page by default (an eyebrow over each heading, gradient-filled
words, an icon tile over each card, a one-sided accent border, a coloured glow, a border with a
wide shadow, "01 / 02" over sections, "Not X. Y." copy, stock adjectives; gaps g53 to g60) are
counted per run without a judge:

```sh
pnpm evals tells <name> --rounds <name>-none,<name>,<name>-<candidate>
```

Each run's pictures and source go to one model (Opus), which lists every place the page has each
mark (`tells@<model>.json` beside the run); `runs/<name>/tells.md` gives per round the mean
count per page and how many pages have one.

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
with their process group, at `--minutes` too. Run a bulk round as a long job (above, "Long jobs").

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
Run again under a name already applied, it drafts what was logged since, and the answers given
to the earlier deck do not answer the new one (below, "Decisions").

A skeptic can then try to knock down what a round's reviewers found:

```sh
pnpm evals verify <round> --skeptics opus,gpt-6.1-sol
```

Each saved review's findings go to the first skeptic that did not write them, with the section's
pictures, its code and the version's rules, and it confirms a finding only where it can point at
what shows it. `runs/<round>/verify.md` says, per version, how much it kept: of the findings the
judges matched with a gap (refuting one costs recall), and of the problems rated in the round's
deck, the real ones kept and the noise refuted (what the skeptic is for). Its verdicts are kept
beside each review (`verify@<model>.json`), so after more ratings it runs again without asking.

Rating a round's deck card by card is long. A model with the skill can make the call on each
problem first, so the person says only whether it is right:

```sh
pnpm evals propose <round> [--model opus]
```

Each section's problems go to the model with its pictures, its code and the checkout's skill to
open, and it answers per problem: fix it (the change, and the rule it rests on) or leave it (why).
The calls are kept in `runs/<round>/<section>/proposals@<model>.json`, and `rate-<round>` is
written again with each card's call; the page then asks Right or Wrong (R, W), and saves the
answer as real or noise as before, so recall and verify read it unchanged. Answers given before
the calls stay. A person agreeing with a call leans towards it: read a rating given against a
call (`recommend` in the deck) as that, not as one given blind.

What the calls cost is read on the problems the person found: `propose <round> --gaps` asks the
same call on the findings the judges matched with a gap (up to four a gap, from several
versions), and `runs/<round>/propose-gaps.md` says how many it would fix and how many gaps keep
at least one fixed finding. A leave there is a real problem the designer would let through.

The held-out sections are the editor's own panels, so what their decks call real is a list of
fixes to the editor, as it was then. `pnpm evals fixes <name> --rounds ep-1,rt-2` checks it
against today's code: each panel's real problems (its sections grouped by the code they share) go
to one model with the old pictures and code and today's files, which says which repeat one
another, which still hold, where, and what the fix takes now. The deck `<name>` has a card for
each that still holds, the smallest fix first, with the fix as the agent's call.

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

Cursor bills its named models (Opus, Gemini) from one pool and Composer and Grok from another,
and nothing in the lab watches either: run a bulk job on Cursor under a guard of your own. The
data directory's `.work/probe/cursor-guard.mjs <pgid> 98 auto|api` is one: it stops a process
group before the pool runs out or anything is billed on demand.

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
system has a token (design-document's `offSystemValues`), into `runs/<round>/off-system.md`. A
page that does not read as this checkout's (a round may have measured another commit) is left
out: the table's last column says how many pages each run's count leaves out, and the run's
heading names them.

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

What the checks measure can be shown to a reviewer too, as the editor shows its review models
what the checks measured on a document (ADR 0061): `recall --inputs pictures,checks` reviews each
section with its pictures and code, then again with the checks' findings beside them as facts
(`shipped+checks`). The findings are the section's `checks.json`, written by `measure --section`
on an editor run at the section's commit, one measurement per theme, each finding with its
element's box from the measured root's corner, the root's box in the window, and a picture of the
root at 2× taken in the same page (`checks-<theme>@2x.png` beside it), so a finding can be cropped
and boxed:

```sh
git worktree add --detach .work/checks/<commit> <commit> && pnpm -C .work/checks/<commit> install
# in the worktree, in a process group of its own: pnpm dev -- --ephemeral
pnpm evals measure http://127.0.0.1:<port>/ --section <section> --root '<the section's element>' \
  --steps <steps.mjs> --checks --hover --stress --grid 4 --ratio 3 --theme dark   # and light
pnpm evals recall <round> --inputs pictures,checks <sections…>
```

A section with no `checks.json` stops the round with the command to write it; one the checks
could not run on holds `{ "commit": …, "measured": [], "notRun": "<why>" }`, and its reviewer is
told so. A reviewer is told each finding once, with the elements it was found on, and that a
clean measurement is not a good design. The sections measured so far are the ones of g02
(`components-panel`), g08 (`tools-bar`), g34 (`layers`) and g37 (`changes`), the gaps every
version missed by eye; their steps are `runs/checks-2/steps/`, and their commits, from before the
history was rewritten, map through `~/Backups/ultrapaint-history/commit-map-2026-11-07.txt`.

## Studies

Two commands count what well-made interfaces do, each in two steps: `annotate` has a model look
at every picture not looked at yet and answer the same questions of each, and `book` counts the
answers and has a model write them up, set against the skill a round recorded
(`--skills-from <round>`, required: the round whose skill the write-up is compared with).

```sh
pnpm evals patterns annotate [--corpus untitled-ui|landing]
pnpm evals patterns book --skills-from <round> [--corpus untitled-ui|landing]
pnpm evals study annotate [--sources opl,typewolf,awwwards,landing] [--model gpt-6.1-sol]
pnpm evals study book --dimension <dimension> --skills-from <round> [--character technical]
```

- `patterns`: how one product builds its interface, per kind of piece (dialogs, settings pages,
  tables, menus…): Untitled UI's shots (`gallery/untitled-ui.json`) or a set of SaaS landing
  pages (`corpus/landing/`). The notes, the counts and the book are in `patterns/` and
  `patterns-landing/`.
- `study`: what the library of well-made sites (`corpus/<source>/`) does, per dimension of
  design (layout, typography, color, spacing, imagery, icons, components, content) and per
  character (technical, humanistic, expressive). A model's notes are in
  `studies/<model>/notes/`, and `book` writes `studies/<model>/<dimension>.md` from the notes of
  `--notes <model>` (gpt-6.1-sol).

What a book says the skill should change is evidence for a gap, never a change to the skill.

## Decisions

When an agent needs several decisions from the person, it writes them as a deck and the person
answers in the browser, one card at a time: a number key answers and moves on, and the answers
are saved as they are given. The last choice of every card is the person's own answer: its number
key opens a field they write in and send (⌘/Ctrl+Enter), and an option picked after it leaves the
words out. On a card with a call, the field is a comment that goes with Right or Wrong instead, or
the own answer when sent alone (Esc, then R or W, sends it with the verdict). Backspace, or
Clear answer, takes an answer back, with an Undo until the card is left. Images go with
the words: pasted or dropped on the field, or picked with Add image (a phone's photos or camera). Each is saved as it is added, in `decisions/<deck>.images/`, and the answer lists them in `images`, by their path from the data directory: open them when reading the answer. A card's text and options are on the left, its pictures on the right, and a bar at the bottom
moves through the deck (← →, A for every answer). The page follows the system's light or dark
theme; the bar's switch (or T) sets one, kept in that browser.

```sh
pnpm evals decide <deck> [--host <tailscale address>]   # decisions/<deck>.json in the data directory
```

A deck is `{ title, intro?, cards }`. Each card has:

- `id`, `title`, an `eyebrow?` and a `body?` in markdown;
- `pictures?`: `{ src, caption, marks? }`, with `src` a path from the data directory. `marks`
  are boxes drawn around what the card asks about, `{ x, y, width, height, label?, at? }` in
  fractions of the picture, the label `above`, `below`, `right` or `inside` it;
- `options`: `{ key, label, leads? }`, where `leads` says what choosing it leads to. The page
  adds the person's own answer after them, so no option asks for words ("Change it: say how");
- `recommend?`: an option's key;
- `proposal?`: the agent's own call, in markdown. With `recommend` and two options, the page
  shows it and asks only Right or Wrong (R, W), from a bar that stays in reach.

The answers land in `decisions/<deck>.answers.json`, each with its label, the card's title and
any comment, for the agent to read back and act on. An answer in the person's own words has no
`choice`, the label "Own answer", and the words as its comment: read it as the decision. Ask the decision itself, with what each
answer leads to and the evidence beside it, and put the quickest cards first. Show each item as
a close-up with a box around it, never a whole screen to search. An item that no picture shows
says so on its card.

A command that writes its deck again (`triage`, `recall --rate`) keeps an answer only while the
deck still has the card it was given to, word for word. When a card reads otherwise or is gone,
its id may name another question: the answers file is first copied whole to
`decisions/<deck>.answers.<time>.json`, and those answers leave `<deck>.answers.json`.

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

`"brief": "facts"` has `brief` write the page's facts and none of its words (`prompts/brief-facts.md`):
who it is for, what it offers, its figures, plans and sections, with every heading, line of copy and
button label left to the agent, so the words an agent writes by habit (an eyebrow, a stock phrase;
gaps g53 and g59) can be counted with `tells`.

Pick screens of every kind the product is used for (landing pages, dashboards, app screens,
settings, forms, empty states), from anywhere: a public site, a prototype, a gallery. Prefer a
page that is the screen alone; a page that frames it (a docs site around an example) puts the
frame in the pictures. A screen behind a login, or only a picture, has no `url`: put its pictures
in `capture/` by hand, under the names `capture` uses (`desktop-fold.jpg`, `desktop-01.jpg`…,
`mobile-fold.jpg`, `mobile-01.jpg`…), and, if there is one, its text in `content.md`.

## What a round leaves

```
runs/<name>/
  round.json            agent, model, commit, the skill tree it ran with (each file's hash)
  skills/shipped/       the skill as the round ran with it: SKILL.md and references/
  skills/<skill>.md     what the server told the agents: the skill's core, the host's own skills
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
  report.md             scores, less is more, gaps, proposed gaps
  panel.md              what the panel found, run by run and section by section
  proposals/<n>-<gap>.md  each recurring gap, drafted as a file for evals/gaps/
```

All of it is in the data directory, on the machine that ran the round. A round from before the
skill was one (ADR 0069) keeps its shape and still reads: its `round.json` has no skill tree,
its `skills/` holds the skills one file each, a finding names a skill, and its `proposals/` are
whole skill files.

## How a run is done

The agent gets the prompt in `prompts/generate.md` with the brief in it, in a design thread of
its own, as a user would type it. Nobody is there to click, so every tool call it asks permission
for is allowed, and every question it asks gets its first option.

Its page is then drawn at each viewport, through the same `set_frame` and `get_screenshot` the
agent has: the first window at the window's height, then the whole page, the frame growing until
the content ends. A page drawn to the window's height (a full-height layout) is its first window.
A viewport is drawn from the variant made for it, `<page>@mobile`, when the agent made one.

## How it is judged

The judge reads the principles (`prompts/principles.md`: less is more first), the brief, the
skill as the round recorded it (its core, and the references the screen's kind and concerns
call for), both sets of pictures and the run's trace, and looks for the places where the agent's
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

and names the file of the skill whose subject it is (`SKILL.md`, the core, for a rule that bears
on most screens; `references/kinds/dialog.md`; `none`), and how the skill covers it:

| Coverage | Means | Fix |
| --- | --- | --- |
| not covered | the skill does not say it | add the rule |
| covered, not followed | the skill says it, the agent did not do it | make the rule harder to miss: an exact value, a row in its file's check table |
| rule misleads | following the skill made it worse | change or remove the rule |
| tool limitation | Ultrapaint could not do it | not the skill: a product issue |

The tool limitations are a by-product worth reading: they are what the editor lacks for designs
like the reference's.

Each run is scored 1–5 per level. The report groups the findings of all runs into gaps and counts
them: seen in every run of a reference, it is consistent; in some, it is flaky. Scores that
disagree by 2 or more between runs of one reference are marked ⚠.

A gap seen in two runs or more that the skill could close is drafted in `proposals/` as a file
for `gaps/`: what happened, what the skill says now, the one change to try and its test. The
report never writes the skill's text, since a change is measured as a gap before the skill
changes (ADR 0065). A draft has no `id`: to keep one, move it into `evals/gaps/` under the next
free id (`pnpm evals gaps`).

### Less is more, counted

After a run, every text its page shows is matched against the brief's content (its lists, tables
and quoted copy, not the brief writer's own words): what is left is what the agent wrote itself.
Each is pictured in its place (`parts/`), and the judge says of each whether it is noise, invented
content, or needed. The report counts the noise and the invented per run; `compare` says whether
a change to the skill made it go down. Your verdict on a text card overrules the judge's.

`prompts/principles.md` is where taste is written down. Add to it what your review comments
keep saying: it goes to the judge and to the synthesis of every round.
