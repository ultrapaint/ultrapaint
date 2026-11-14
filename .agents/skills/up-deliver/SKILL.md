---
name: up-deliver
description: Delivers the stories you marked to start — in sequence in this thread, or across parallel workers — and prints where each one stands. Run it bare to coordinate the queue, or with one issue to deliver that story.
disable-model-invocation: true
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# Deliver

Takes stories from ready to deployed with nobody driving each step. It has two roles, chosen by how it is run:

| Run | Role |
| --- | --- |
| `/up-deliver` | **Coordinator** over the stories the **Ready signal** marks |
| `/up-deliver SHOP-1 SHOP-7` — two or more issues | **Coordinator** over exactly those. Naming a story on the run is the intent, so the **Ready signal** is skipped |
| `/up-deliver SHOP-1` — one issue | **Worker** on that story, in this checkout. It is what the coordinator starts in each thread, and what you run by hand |

The coordinator reconciles what is in flight, reads the queue for questions before work starts, delivers the free stories the way the **Orchestration** setting says, and prints one table. A **worker** claims one story and walks [`/up-implement`](../up-implement/SKILL.md) → [`/up-to-pr`](../up-to-pr/SKILL.md) → [`/up-ship`](../up-ship/SKILL.md).

Two properties hold it together:

- **The tracker is the coordination.** Workers never talk to each other. Everything one needs to know about the others is on the tracker: a claim, a status, a branch, a PR, a comment.
- **A claim is a race you can lose.** Two workers reading the queue at the same moment see the same story. Losing the race is normal and costs nothing.

Read the **Tracker**, **Ready signal**, **Orchestration** and **Checkout** settings when the run starts, in that order, per [Settings](#settings). The coordinator claims stories and starts work, so it asks for each one that is missing; a worker run by hand asks only **Tracker** and **Checkout**. With **Tracker** at **None**, both roles stop before asking the others, and say so: the queue, the claim and the table all live on the tracker. Route a story given in the chat through `/up-implement` instead.

## The coordinator

One invocation is one **beat**. Under **In sequence**, the beat lasts until the queue runs dry. Under either parallel option, the beat starts what it may, prints the table and ends, and the cadence is yours:

```
/loop 10m /up-deliver
```

A beat carries nothing between beats. Every beat re-derives its picture from the tracker, the branches and the open PRs, so ten beats or one, a crash between them or a week, the answer is the same.

### 1. Reconcile what is in flight

A story is **in flight** from its claim to its deploy, in one of three stages: **building** (claimed, no PR), **review** (PR open) and **shipping** (merged, deploy unfinished). Where the project keeps a board, each stage is a status on it, and the status is a **claim to be checked**: a worker that died mid-story leaves a card reading building forever, and a stale card reads as work in progress.

In flight is every story at a building, review or shipping stage where the project keeps a board. Without one — or to catch what a board missed — it is every open issue a claim assigned, with a branch linked to it, or with an open PR that closes it, plus every open issue whose comments carry the `**A worker needs a decision**` line: on GitHub, `gh search issues --repo <owner>/<repo> --state open --match comments '"A worker needs a decision"'`.

For every in-flight story, take the first row that matches:

| What exists | Reading |
| --- | --- |
| **The issue is closed** | It is finished, whatever the board says. Move it to done. |
| An unanswered `**A worker needs a decision**` comment, on the issue or its PR | Parked. Resume nothing; list it under Parked. Where the board has a Parked stage, the card reads Parked. |
| A merged PR, the deploy unfinished | Shipping |
| An open PR | Review |
| A pushed branch linked to the issue (on GitHub, `gh issue develop --list <n>`), no PR | Building — it rejoins at `/up-to-pr` |
| No branch and no PR | Nothing was built. Remove your claim, and return it to the queue: restore the Ready signal the claim took off, where it took one. A story named on the run only loses your assignment. That return is the one Ready signal write a skill makes. |

The closed row moves a card to done by hand, where a board would usually do it on the close. That is safe here because the closed state **is** the confirmation, read before the write: a card closed before the board's automation existed, or written over afterwards, has no second chance to correct itself.

Say what you changed and why. A card you silently moved is a card the user cannot trust.

Done when every in-flight story matches something that actually exists, and every correction is named.

### 2. Pre-flight the queue

The queue is the stories named on the run, or else every story the **Ready signal** marks. Under **None** with no story named, there is no queue: say so, and stop. Read each **once, before anything starts**, and ask everything it needs in one round — each question as a comment on its issue that opens with the `**A worker needs a decision**` line, so § 6 sees the reply, and listed in the report. A question asked here is answered while workers run; the same question found mid-build parks a story and costs a day.

Check each against two things:

- **The Ready bar** in [`STORIES.md`](../up-to-story/STORIES.md) `## Ready`. A story marked to start without a ready label is the common case, not an error: the signal is intent, and the bar is a property.
- **The irreversible steps** in [What earns a go/no-go](#what-earns-a-gono-go). A destructive migration step, a production write, a credential rotation and a one-way third-party call are all readable from a story's text.

**Sort, never block.** A story carrying a question stays in the queue, shows under **Parked** until the answer comes, and is not claimed; the rest are free to claim. One vague story must not stall three good ones.

What this cannot catch is what the code turns out to look like. Say that rather than implying the queue is now safe.

Done when every queued story is either free to claim or named with the question it needs answered.

### 3. Find the free stories

Take the queue in priority order — the priority axis where the **Labels** setting defines one, the board's order otherwise — and hold back each story a signal below names:

| Signal | Reading |
| --- | --- |
| An open blocking edge ([`SPLITTING.md`](../up-to-story/SPLITTING.md)) | Not free. The blocker ships first. |
| Someone other than this run's own claim is assigned | Somebody holds it. Not free. |
| Its scope matches a story in flight | Assume the same files. Not free. |
| A scope that every other part depends on — a shared layer, root files — while anything at all is in flight | It fans out to every gate. Not free. |

A blocking edge is a hard order you cannot overrule; a scope collision is a heuristic you can. Name which held each story.

Done when every queued story is free, or named with the signal that held it.

### 4. Deliver, per Orchestration

- **In sequence, in this thread** — before the first claim, run the worker's [§ 1 check](#1-check-this-checkout) on this checkout: a dirty checkout stops the beat before a claim, not after. Then take the first free story, run the [worker](#the-worker) on it here, then come back to step 3. Stop when nothing is free.
- **Parallel threads it starts** — count the stories in flight. For each free story, up to the setting's most workers at once: [claim it](#2-claim-it), then start one thread with the harness's thread tool, running `/up-deliver <issue>` in a checkout of the kind the **Checkout** setting gives a new story. Name each thread after its story, so the user can find it.
- **Parallel, started by you** — start nothing. Name each free story beside a free checkout of a kind the **Checkout** setting lists, so the user can run `/up-deliver <issue>` there.

Under **Parallel threads it starts**, a harness without a thread tool falls back to **Parallel, started by you** for this beat, and says so.

Done when every free story is delivered, started, or named for the user — up to the width the setting allows.

### 5. Print the table

One row per story in flight, then the tails. The table **is** the beat's report — there is no prose summary above it. Under **In sequence**, the run ends in § 7's report, with this table as its details.

```
Issue     Story                                  Stage     For   PR    Waiting on
SHOP-184  billing/invoices: retire the PDF export Building  22m   —     —
SHOP-191  accounts/profile: warm the account     Review    6m    #203  CI: accounts gate
SHOP-177  shared/platform: port registry         Shipping  3m    #198  deploy run 4471

Queued (3):  SHOP-205 · SHOP-206 (held — blocked by SHOP-205) · SHOP-211 (held — collides with SHOP-205, shared scope)
Parked (1):  SHOP-199 — worker question, unanswered 40m
Not ready (1): SHOP-188 — fails the Ready bar: acceptance criteria name no test level
```

Every column comes from the tracker and `git`, with issues named by the **Tracker** setting's prefix. The table is fixed-width and already carries the title, so it skips the bold title a first mention would otherwise get.

- **For** — time in the current stage, from the branch's last commit and the PR's last update. This is the column that exposes a stuck worker, so it earns its place over anything prettier.
- **Waiting on** — the concrete blocker: a named failing check, an unresolved review thread, a deploy run id. `—` means nothing is blocking and the worker is simply working.
- **Queued** — in claim order, and every held story names its cause.
- **Parked** and **Not ready** — the stories waiting on you, and why.
- **Ready, not queued** — when the queue is empty, the stories at the Ready stage, so you can see what you could queue next.

Recompute the ordering every beat. Stories join the queue while workers run, so an order computed once is wrong by the next beat.

Done when every in-flight story has a row whose stage, age and blocker match the PR, and every queued story is either claimable or carries its hold.

### 6. Relay what the user said

Steering is a **comment**. It survives a crashed session, it works from every tool, and it lands where the decision belongs.

Each beat, read new comments on the in-flight issues and their PRs. A comment that changes what a worker should do gets relayed to the worker holding that story. A question counts as answered once a later comment exists that is not a worker's own — every worker comment opens with a bold marker line. An answer moves that story on: drop the label the question added, where it added one, move a Parked card to the stage its branch or PR reads in § 1, and say so in the report. The next free worker resumes it from there.

Where a worker is reachable through the harness — a thread this coordinator started — relay immediately and say you did. Where it is not, the comment stands on the issue and the worker picks it up at its next stage boundary. Say that too, because the difference is whether your instruction lands in seconds or in twenty minutes.

Done when every new comment on an in-flight story is relayed, answered or explicitly noted as needing nothing.

### 7. End the beat

Under either parallel option, print the loop line and stop: a beat that keeps running is a beat whose table is already out of date. Under **In sequence**, end with `/up-ship`'s report shape for the run as a whole, the table in its details.

Stop when the queue has nothing free, and say which: empty, everything blocked, or everything colliding with work in flight. **Do not idle waiting for a story.** You are a session the user started; ending cleanly costs them nothing, and a spinning coordinator costs them a checkout.

## The worker

One story, in this checkout. Started by the coordinator, in a thread or in sequence, or by hand with one issue named.

### 1. Check this checkout

`git status --porcelain` empty, no merge or rebase in progress, and at `origin/<default>` — on the default branch, or on a fresh branch with no commits past it, as some checkout kinds start — the local default branch where the repo has no remote. A dirty checkout is **somebody's work** — stop, name the files, and change nothing (`/up` `## Working rules`).

Then find this checkout's kind in the **Checkout** setting, and confirm its setup has run. A checkout whose kind lists a setup step that has not run is setup you own: run it, or — when it needs the user — stop and say which checkout needs what. The worker never reaches into a sibling checkout, and never creates one.

Done when the checkout is clean, on the default branch, and set up for its kind — or you have stopped and named what is wrong with it.

### 2. Claim it

Skip this when the coordinator already claimed the story for this worker.

Claim it in one write, and read it back:

- **A board column** — move the story from that column to the Building stage (`/up`'s [`BOARD.md`](../up/BOARD.md)), then re-read the item. If it does not read Building with you as the writer, you lost the race.
- **A label** — assign yourself, then re-read the issue. If someone else is assigned too, you lost the race: unassign yourself. If you are the only one, remove the label.
- **Named on the run** — assign yourself, and move it to the Building stage where the project keeps a board.

This single write is the only thing stopping two workers building one story, so it happens before the branch, not after. A worker that lost the race stops, and says which story it lost.

A story that fails the Ready bar in [`STORIES.md`](../up-to-story/STORIES.md) `## Ready` is not yours to build or to grill, whatever its labels say. Started by the coordinator, trust its pre-flight: it checked the bar. Started by hand, check the bar yourself. Report a story that fails it and stop; the coordinator's pre-flight is what asks about it.

Done when you hold the claim, or have stopped and said why.

### 3. Walk the route

`/up-implement`, then `/up-to-pr`, then `/up-ship`. They move the story through building, review and shipping as they cross each boundary, which is what gives the coordinator's table something true to render.

Read each skill and follow it. Where one stops on a condition it cannot clear, that is a **park**, not a failure — see [Escalation](#escalation).

Done when the story is deployed and the checkout is clean, or the story is parked with the branch pushed.

## Escalation

Autonomy is the default and the bar to break it is high. Before asking anything, **exhaust the harness**: read the routed standard, read the neighbouring implementation, run the dry run, take the reversible path. A question you could have answered by looking costs a day of wall-clock and buys nothing.

Two things earn a question, and each has exactly one surface.

**A question about the spec** → the **issue**. The story is ambiguous, contradicts itself, or never decided something the build turns on. That is a defect in the spec, so the answer belongs where the spec lives. Add the discovery label for an unmade decision or the info label for a missing fact. Never open a PR to carry a spec question: a PR is where work is reviewed, never where it is proposed.

**A go/no-go on the work** → the **PR**. Take the branch to a normal reviewable PR through `/up-to-pr`, then ask in a comment on it. Nobody can answer *is this safe to run* without the diff in front of them.

Either way, one comment opening with the literal line `**A worker needs a decision**`, then the single question, the options, your recommendation, and what you will do if no answer comes. That first line is how the coordinator finds the question and tells a reply from silence.

Then park the story: remove your claim, and move the card to the board's Parked stage where it has one ([`BOARD.md`](../up/BOARD.md)). Without that stage, the card keeps the stage it had. Never return a parked story to the queue: its branch or PR holds the state, and the next worker resumes from there.

### What earns a go/no-go

Almost nothing here is one-way. A bad commit is a revert, and a failed deploy is fixed by the next PR ([`/up-ship`](../up-ship/SKILL.md) `## 2`). Build it, run it, and let the review catch it.

Escalate on one test: **the step cannot be undone from this repo.**

- The destructive step of a migration — the one that drops the old shape. Widening a schema and backfilling are reversible and they are yours: write them, run them the way the project's migration standard says, open the PR, and ask before the drop lands.
- A production write that what remains cannot rebuild.
- Rotating or revoking a credential already in use.
- A one-way third-party action — a billing call, mail to real users, deleting a deployment.

Everything else you decide, do, and record in the PR body as a decision you made.

### Park, do not wait

**The branch is the parking place.** Commit what exists and push it, because work that lives only in a checkout is one reset from gone — `git stash` puts it exactly where the next reset destroys it. A worker started for one story then stops; under **In sequence**, the coordinator goes back to step 3 and takes another.

A parked story is resumed by whichever worker next finds it: an issue with a pushed branch rejoins at `/up-to-pr`, one with an open PR rejoins at `/up-ship`. Ten minutes or a week later costs the same, because the branch and the PR carry the state.

## Guardrails

- **A worker decides how, never what.** Every implementation call is yours to make and record. What the product should do was decided in the story.
- **You never set the Ready signal on a story the user did not mark.** That gate is the user's, and a skill that queues its own work has removed the only control the gate exists to give. The one write is the return in § 1: a story the user marked, whose claim produced nothing.
- **The tracker is the state.** Anything that exists only in this context is gone when this session ends — a decision, a park, a failure reason all get written to the issue or the PR.
- **A dirty checkout is evidence, not a chore.** It is the one thing here you never fix.
- **Cut from `origin/<default>` every time.** Parallel workers all aim at one moving default branch. A branch that falls into conflict with it is rebased by the `/up-babysit` sweeps that `/up-ship` runs.
- **An empty tail has to mean empty.** `Parked (0)` says every story is moving. A reader who cannot tell an empty list from a forgotten one has to go and check for themselves.
- **Report what you cannot see.** A beat that could not reach something — a deploy run, a check, a thread — says so on the row rather than printing a `—` that reads like "nothing wrong".

## Settings

This skill reads two settings `/up` `## Settings` defines — **Tracker** and **Checkout** — and two of its own, **Ready signal** and **Orchestration**. It claims stories and starts work, so it asks for each one that is missing. It reads **Labels** and **Scopes** at the coordinator's § 3 when they are set, and asks for **Labels** only when it is about to write a label — the discovery or info label at an escalation. Each `###` heading below is one setting: its topic, its question, and its options. `/up-setup` reads the same headings to ask every setting up front.

1. **The settings home.** The `## Agent skills` block of the root `AGENTS.md` — or `CLAUDE.md`, whichever the project has — names where `up-*` settings live and in what form. With neither file present, first ask which to create, recommending `AGENTS.md`, which most agents read. With no such line, ask the user where to keep them, the default first:
   - **`docs/agents/<topic>.md`** (default) — one Markdown file per topic, one `##` heading per setting, named as the setting. Other headings in the file are the project's own notes.
   - **One file** — at a path the user names.
   - **Another form** — as the user describes it.

   Write their answer as one line in that block, creating the block when it is missing — for the default, `` `up-*` settings: `docs/agents/<topic>.md`, one heading per setting. ``
2. **The setting.** Read it at the settings home. Present: use it, and ask nothing.
3. **Missing.** Ask its question below, recommended answer first, with the follow-up its option needs. Write the answer at the settings home, tell the user where it went and that they can edit it there or through `/up-setup`, then continue.

### Ready signal

Topic `delivery`. Question: *How do you mark a story you want started now?*

| Option | Follow-up | Recommend when |
| --- | --- | --- |
| **A board column** | The column's name, such as `Queued` | The project keeps a board |
| **A label** | The label's name, such as `agent-queue` | The project has no board |
| **None** | — | Stories are named on the run, every time |

The signal says **you want this started now**, which is intent. A ready label says the story is specified well enough to build, which is a property of the story. Keep them apart, so a story can be honestly ready and still not wanted yet: a ready label is never the signal. Only a human sets the signal — a skill sets it only on their explicit yes (`/up-triage` offers it on a ready story), or returns it (§ 1) — and naming stories on the run skips it.

### Orchestration

Topic `delivery`. Question: *How should the coordinator deliver the stories it may start?*

| Option | Follow-up | Recommend when |
| --- | --- | --- |
| **In sequence, in this thread** | — | Default: one checkout, or work you want to watch as it happens |
| **Parallel threads it starts** | The most workers at once, and the harness tool that starts a thread — such as T3 Code's `create_threads` | A thread tool is among this session's tools, and the **Checkout** setting has a kind a new thread can set up alone |
| **Parallel, started by you** | — | Several prepared checkouts, and no thread tool |

Every worker takes its own checkout, so the width is bounded by the machine: recommend a width from what one checkout's setup and full suite cost to run.
