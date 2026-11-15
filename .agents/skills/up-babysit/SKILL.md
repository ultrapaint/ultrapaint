---
name: up-babysit
description: Sweeps an open PR toward merged. Use when a PR needs watching, a red check fixed, or a merge once its gate is clear.
metadata:
  pack: epicparty/skills
  version: 0.2.0
---

# Babysit

A feature is finished when it is **merged**, not when it is written. This skill carries it the rest of the way.

One invocation is one **sweep**: get the work onto a PR, read that PR's state, give every open finding a disposition, push the fixes, then merge if the gate is clear. A sweep over a PR that gained nothing since the last one ends in a no-op report, so sweeps are cheap to repeat — by hand, or on a `/loop` tick.

The PR lives on GitHub. Reach it with whatever this session has wired up — the `gh` CLI, GitHub MCP tools, whatever is available. The steps below name what to read and write, not which tool does it.

## 1. Pin the target

The argument is a PR number; with no argument, the current branch. Either way, resolve it to one PR and find out whether that PR exists yet.

Done when you have the PR's number, or know the branch hasn't got one.

## 2. Open the PR, if the feature hasn't got one

Skip this step when the PR already exists — which is the usual case, since a sweep is normally the second thing to happen to a branch.

Otherwise the branch needs a PR before there is anything to babysit. Opening one is its own job with its own rules — the title, the reviewer-facing body, the suite report, the board — and they live in [`/up-to-pr`](../up-to-pr/SKILL.md). Read `skills/to-pr/SKILL.md` and follow it, then come back with the PR number.

Done when the PR exists and you have its number.

## 3. Read the PR's state

One read, covering all of:

- **head SHA** — every judgement in this sweep is against it
- **state, draft flag, mergeability, review decision**
- **checks and commit statuses on that head SHA**, each with whether it gates the merge — an automatic reviewer reports its run as one or the other
- **review threads with their resolved state** — a plain `gh pr view --comments` flattens threads and drops resolution, so reach for the GraphQL `reviewThreads { isResolved }` field or a tool that reports it. Re-litigating a thread someone already resolved is noise on their PR.
- **PR-level comments** — where bots post their bug reports

Done when you can name the head SHA, the failing checks, and the unresolved threads.

## 4. Collect the findings

A **finding** is anything asking for a change: a failing check that gates the merge, an unresolved review thread, a bug a bot reported in a PR comment, a conflict with the base.

- For a failing check, read the failure — `gh run view <run-id> --log-failed` or the equivalent job-log call. A job name tells you which suite broke, never why.
- Reproduce test, type, and lint failures locally with the command the failing job ran — its log names it, and the workflow file holds it. Running anything else reproduces something other than what CI saw. A failure you can't reproduce is one you can't confirm fixed.
- **Advisory failures are reported, never chased.** A check is advisory when branch protection doesn't require it, or when its step carries `continue-on-error`. Where you can't tell what's required, treat every failing check as gating and let the exception be argued out loud.
- A gating failure that also reproduces on the default branch isn't this PR's. Say so once in the thread with the evidence and carry it as reported.

Done when every finding points at a concrete log excerpt or diff line, or is dismissed with a stated reason.

## 5. Give every finding a disposition

Three dispositions, one per finding:

- **Fix** — the finding is correct and the change serves the PR's goal, even where it grows the diff, or it is a **small fix** (`/up` `## Vocabulary`).
- **Push back** — the finding is wrong, already handled elsewhere, or asks for work this PR never claimed. Reply in the thread with the reasoning and leave it unresolved: overruling a reviewer is the reviewer's call.
- **Defer** — correct, but it serves another goal and is larger than a small fix. Say so in the thread reply and add it to the PR body under **Found in passing**; the user decides whether it becomes a story.

Weigh a human reviewer above a bot — bots flag style they lack the context to judge. Correctness outranks both: a bot that finds a real bug gets a fix.

Done when the finding list has no undispositioned entries.

## 6. Fix, validate, push

Route the work through the project's standards the same way the original change would be: the agent files and what they route each path to ([`/up-implement` § 3](../up-implement/SKILL.md#3-route-the-standards)). A babysit fix is held to the bar of the code it lands in.

A conflict with the base is fixed first, by a rebase onto `origin/<base>` (`/up`'s [`GIT.md`](../up/GIT.md) `## Catching up with the default branch`). The other fixes are then written against the base they will land on, and one suite run covers them all.

Validate before pushing, per the **Full suite** setting ([Settings](#settings)). Under **CI runs it**, the push is what runs it, and step 9 reads the result. Under any other option, run what it names for what the PR touches — the suite is yours to run, because nothing else will.

Commit per `GIT.md` `## Commits`, and push to the PR's head branch — after a rebase, with the pinned lease that `GIT.md` gives. Where the PR body carries a suite report, update it to name the commit you just validated — a report against an older commit says nothing about the one that will merge.

Done when your work is committed, the push landed, and `git status` shows nothing of yours left behind.

## 7. Answer the threads you touched

For each fixed finding, reply in its thread naming the commit that addressed it, then resolve the thread. Resolution is GraphQL-only — the `resolveReviewThread` mutation against the thread's id, since REST exposes no equivalent:

```bash
gh api graphql -f query='mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread { isResolved } } }' -F id=<thread-id>
```

The thread is the reviewer's only window into what you did; a fix nobody is told about reads as an ignored comment, and that is how a PR stalls. Pushed-back and deferred threads stay unresolved — you replied, the reviewer decides.

Done when every fixed finding has a reply and a resolved thread, and every other finding has a reply.

## 8. Review the diff

**Ours, on the first sweep and after every push.** Run [`/up-code-review`](../up-code-review/SKILL.md) against the merge-base (`git merge-base HEAD origin/<base>`), passing it the issue the PR closes as its spec, on the first sweep, and on later sweeps only when you pushed. An unchanged diff yields an unchanged review, so re-running it spends tokens to learn nothing. Feed its findings back through step 5. A Standards finding is usually a fix. A Spec finding that names a missing requirement means the feature isn't done — report it and stop short of the gate.

**External.** An **external review** comes from a reviewer outside this session — a review bot installed on the repository. The **External reviewers** setting lists each one by kind; read it on the first sweep, per [Settings](#settings).

**An automatic reviewer reviews every PR on its own.** Its review is the PR's external review, whether the change is substantial or not, and every head commit needs a review of its own: the substantial-push rule below is for the normal and security kinds only. Never ask the user about it, and request it only when the head commit has **no review** from it:

- **No review** is what its row defines; by default, its check or status missing on the head SHA once the PR's other checks there have finished, or ended skipped, rate limited or neutral. A skip the row counts as a review — every file filtered out by the bot's config, "No files to review" — is its review.
- **Then post its re-request comment.** After a rate limit, post it only once the limit has lifted — the bot's message says when; a sweep before then reports the wait and posts nothing.
- **Each request counts against the row's cap** of requests per PR. With the cap spent and still no review on the head SHA, request no more: the gate holds the PR open, and the report says so.

Its findings, in review threads or PR comments, go through steps 4 and 5 like any bot's.

**A normal or security reviewer reviews only when asked, rarely, for a substantial change.** Its quota is small: the setting gives how to request each and the most reviews each one gives a PR. Our review carries most PRs; a requested one is the exception:

- **Substantial** means the diff changes architecture or core logic: a module boundary, a schema or migration, auth and permissions, a shared package other code depends on, the rules of a domain flow. Copy, styling, docs and test-only changes are not substantial.
- **Requested without asking** when the user asked for an external review, or for a deep or deeper review.
- **Otherwise asked once.** For a substantial change, ask the user once per PR whether they want an external review, and from which reviewer when more than one is enabled. Record the answer in the PR body, so a later sweep reads it rather than asking again. A change that is not substantial gets no ask. Under [`/up-deliver`](../up-deliver/SKILL.md) nobody is there to answer, so a substantial change gets its external review without asking, within the caps.
- **One big review of each requested kind.** Request it once our review's findings are fixed and pushed, so it reads the shape that will merge. A later push earns another only when that push is substantial on its own — a rebase whose conflicts touched architecture or core logic, for example — and only within that kind's cap.
- **A security review** is for a change to auth, permissions or secrets themselves, not to code beside them. Spend its cap by how sensitive the code is: a later push earns another only when it touches that code again.

A later sweep reads its findings at step 3 and dispositions them at step 5 like any other bot.

Done when the current diff has had our review, every automatic reviewer has reviewed the head commit or has a re-request out, a rate limit to wait for, or its cap spent, the requested kinds are settled — requested, not wanted, or not earned — and every finding raised carries a disposition.

## 9. The merge gate

Take a fresh read **after** your last push — a gate judged on state from before it is a gate judged on the wrong commit — and merge when all of these hold on the current head SHA:

- open, not a draft, no conflicts with the base
- every gating check has run **on that head SHA** and passed; a pass inherited from before your push is a **stale green**, and merging on one merges untested code
- no check still running
- no unresolved thread, and no reviewer sitting on changes-requested
- every **open question** in the PR body has an answer — a call you made *for* the user is theirs to take while the diff is open, and this merge is what closes that window
- every **automatic** reviewer has reviewed **that head SHA** — its run finished there, and not as **no review** (step 8) — and every finding it raised carries a disposition. No review there with its cap spent holds the gate: report it, and the user decides whether to merge without it
- the requested kinds are settled (step 8), and every external review requested has landed; merging while one is still running throws away quota you spent
- code-review findings fixed or dispositioned
- where the **Full suite** runs locally, the PR body's suite report names **this** head SHA — that report is the only evidence the merging commit was ever tested

Then merge the way the **Merge strategy** setting says ([Settings](#settings)), and delete the branch:

```bash
gh pr merge <pr-number> --rebase --delete-branch   # --squash or --merge per the setting
```

`/up`'s [`GIT.md`](../up/GIT.md) `## Merging` says what each strategy leaves on the default branch. Where a merge queue is enabled, this enqueues the PR rather than merging it — that is success; report it as queued and let the queue's own gate run.

Merging is the one irreversible act in the sweep. With the gate clear, take it — a merged PR is the whole point. With any part of it unclear, report and leave the PR open.

## 10. Report

State, in a few lines: the PR, the head SHA you ended on, each finding with its disposition, what you pushed, check status, and either the merge result or the precise gate condition that stopped it. Name what you left for a human.

A merged PR is not yet a shipped one. [`/up-ship`](../up-ship/SKILL.md) runs these sweeps and then follows the merge into production.

## Guardrails

- **The PR's history is append-only, except for a rebase onto the base.** Review fixes land as new commits, because amend and force-push move ground the reviewer is standing on. A conflict with the base is the one rewrite: rebase onto `origin/<base>` by `/up`'s [`GIT.md`](../up/GIT.md) `## Catching up with the default branch`, and never merge the base into the branch.
- **Checks are evidence.** Make the code satisfy them, and leave workflow files, required-check settings, and `continue-on-error` flags as they are — editing the gate to pass it forfeits the only signal the PR has.
- **Reviews get answered.** Dismissing a review or approving the PR yourself is the human's call, in every case.
- **The story's goal is the PR's scope, and a small fix rides along.** A finding the goal needs is a fix, and so is a **small fix**. A larger finding that serves another goal is deferred under **Found in passing**, and the user decides whether it becomes a story.

## Settings

This skill reads two settings `/up` `## Settings` defines — **Full suite** at § 6 and **Merge strategy** at § 9 — and one of its own, **External reviewers** at § 8. It runs, merges and requests what they name, so it asks for each one that is missing. Each `###` heading below is one setting: its topic, its question, and its options. `/up-setup` reads the same headings to ask every setting up front.

1. **The settings home.** The `## Agent skills` block of the root `AGENTS.md` — or `CLAUDE.md`, whichever the project has — names where `up-*` settings live and in what form. With neither file present, first ask which to create, recommending `AGENTS.md`, which most agents read. With no such line, ask the user where to keep them, the default first:
   - **`docs/agents/<topic>.md`** (default) — one Markdown file per topic, one `##` heading per setting, named as the setting. Other headings in the file are the project's own notes.
   - **One file** — at a path the user names.
   - **Another form** — as the user describes it.

   Write their answer as one line in that block, creating the block when it is missing — for the default, `` `up-*` settings: `docs/agents/<topic>.md`, one heading per setting. ``
2. **The setting.** Read it at the settings home. Present: use it, and ask nothing.
3. **Missing.** Ask its question below, recommended answer first, with the follow-up its option needs. Write the answer at the settings home, tell the user where it went and that they can edit it there or through `/up-setup`, then continue.

### External reviewers

Topic `reviewers`. Question: *Which review bots outside this session review this repository's PRs — on their own, or when asked — and how often may each be asked?*

| Option | Follow-up | Recommend when |
| --- | --- | --- |
| **These reviewers** | One row per reviewer and kind. **Automatic** — it reviews every PR on its own: the check or status name its run shows on the head commit, such as `CodeRabbit`; the comment that re-requests it, such as `@coderabbitai review`; the most requests per PR; and what counts as **no review** from it — by default its run missing, or ended skipped, rate limited or neutral — with any skip that counts as a review, such as every file filtered out by its config ("No files to review"). **Normal** or **security** — it reviews only when asked: the PR comment that requests it, the most requests per PR, and any rule its trigger needs | A review bot is installed — `gh api orgs/<owner>/installations` where the owner is an organisation — or has reviewed, commented or reported a check on the repository's recent PRs (`gh pr list --state merged --limit 20 --json number,comments,reviews`, then `gh pr checks <n>` on a few). A bot whose review or check appears on PRs where nobody asked for it is **automatic**: CodeRabbit, Copilot code review. One that only answers a request is **normal** |
| **None** | — | No review bot is installed: step 8 runs our review alone |

A reviewer the setting does not list is never requested, and an automatic one it does not list is a bot like any other: its findings still go through step 5, but the gate does not wait for it. Enabling one means installing it on the repository first, then adding its row.
