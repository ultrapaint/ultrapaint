---
name: up-ship
description: Takes a PR to merged, confirms the production deploy landed, and returns the checkout to a clean slate. Use when asked to ship or deploy.
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# Ship

Merged is not shipped. `/up-ship` drives the work to merged, then follows it into production and confirms it arrived.

Three stages. The second is the one everything else skips; the third is what leaves a **clean slate** for the next task.

## 1. Drive it to merged

A branch with no PR gets one first: [`/up-to-pr`](../up-to-pr/SKILL.md) validates the head commit, writes the reviewer-facing body, and opens it.

Then run [`/up-babysit`](../up-babysit/SKILL.md). One invocation is one **sweep**: read the PR's state, dispose of every finding, push the fixes, merge when the gate is clear.

A sweep that cannot merge ends by naming the gate condition that stopped it. Read that condition and act on it:

- **Waiting on a check, a queue, or the external review the sweep requested** — wait for it, then sweep again. Sweeps are cheap; a sweep over a PR that gained nothing ends in a no-op report.
- **Waiting on a human** — a review sitting on changes-requested, a thread you pushed back on, an **open question** the PR raised, a question about an external review that the user has not yet answered. Report and stop. Overruling a reviewer is theirs, not yours, and so is answering the question — ship it once they have, and it costs them one word instead of one PR.
- **Blocked on work outside the PR** — report it with what is holding it.

**Where the project keeps a board, set the Shipping stage once the gate is clear and immediately *before* the merge** (`/up`'s [`BOARD.md`](../up/BOARD.md)). It covers step 2 as well as the merge, so the story stops reading as in review the moment nobody is reviewing it any more.

The ordering is the whole point. The PR's closing link closes the issue **on** the merge, and a board that moves closed issues to done does it then. A shipping write landing after the merge would sit on top of that done and stay there, because the trigger is spent and never fires again. Writing first costs nothing and cannot collide.

Done when the PR is merged, the board — where there is one — read shipping before it, or you have named the gate condition and who owns it.

## 2. Confirm the deploy

Read the **Deploy** setting now, per [Settings](#settings). A merge is a request to deploy; this step finds out what happened to it. Under **None**, nothing deploys on merge: say so, and go to step 3.

**Which deploys to watch.** Every deploy the merged change triggers. A change to code that several deployables share fans out to **all** of them, so watch each one — a shared change that breaks one deployable's build breaks that deploy alone, and nothing else will tell you.

```sh
gh run list --workflow=<workflow> --branch <default> --limit 3 \
  --json databaseId,headSha,status,conclusion,createdAt
gh run watch <run-id>
```

Find the run whose `headSha` is your merge commit. A run against an older SHA is somebody else's deploy.

**Three outcomes, and two of them are success:**

- **Deployed.** The run is green, and the **receipt** the setting names exists — a release tag, a release commit, a version the live app reports. The receipt is the evidence the deploy finished rather than merely started.
- **Skipped.** The workflow decided nothing it ships changed, and skipped. That is the pipeline working. Report it as skipped, not as failed.
- **Failed.** Read the failing job's log (`gh run view <run-id> --log-failed`). The fix is a normal PR through `/up-implement` and `/up-ship` again, never a hand-push to the default branch.

Done when every triggered deploy has reached deployed, skipped, or failed, and you can say which.

## 3. Back to a clean slate

The next task starts wherever this one left the checkout. Leave it with nothing of this task still lying around.

This step runs **only after the merge landed**. A PR still sitting at a gate has work left on its branch, and the branch is where that work happens.

Read the **Checkout** setting now, per [Settings](#settings), and find which kind of checkout this is. Then carry out that kind's cleanup:

- **Switch back** — the default for **This checkout**:

  ```sh
  git status --short                        # anything here that is not yours stops the switch
  git checkout <default> && git pull --rebase
  git branch -d <branch> && git fetch --prune
  ```

- **Commands** — run them. Where the user chooses among them, ask, and run their choice **last**: a cleanup that removes the checkout removes the directory this session works in. A command that refuses a checkout with uncommitted or unpushed work is reported to the user, and overridden only on their word.

Under [`/up-deliver`](../up-deliver/SKILL.md) nobody is there to choose, so ask nothing. A checkout the coordinator reuses for the next story switches back. A checkout started for this story alone is kept as it is, and the report names it for the user to clean up.

Three things the commands do not tell you:

- **`-d` refusing is expected after a rebase or squash merge.** The commits reached the default branch under new SHAs, and git cannot see the old branch as merged. The merged PR is the authority; once you have confirmed it merged, `-D` is the correct delete.
- **Uncommitted work that is not yours stays put** (`/up` `## Working rules`). Switch branches only when `git status` is clean or carries nothing but your own leftovers. Otherwise leave the checkout alone and name the files in the report.
- **Confirm the issue closed, and that the board followed** where there is one. Check both, because they fail differently: an issue still open means the closing link never landed — unless this PR was a stage that named the story as a part, and the story stays open by design until its last stage — while an issue closed with its board card still reading shipping means something overwrote the board's own move. Report either rather than setting done by hand. On GitHub:

```sh
read -r owner name < <(gh repo view --json owner,name --jq '"\(.owner.login) \(.name)"')
gh api graphql -f query='
  query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ issue(number:$n){
    state projectItems(first:5){ nodes{
      fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } } }' \
  -f o="$owner" -f r="$name" -F n=<issue>
```

Done when the issue is closed with the board — where there is one — on done, and the checkout is settled: its kind's cleanup carried out, with `git status` clean and the shipped branch gone locally and remotely, or the user's choice carried out. Otherwise, name which of those stopped and why.

## 4. Report

Three sections, in this order. The message lands in a chat the user reads from the bottom up, so the last section is the first one they see. Evidence goes first and the ask goes last.

**Details** — the evidence: findings and their dispositions, each deploy run, anything skipped and why, the commands you ran.

**TL;DR** — five lines at most, one per thing that is true at the end: the issue, the PR and its merge commit, each deploy's outcome, the receipt now live, the state of the checkout.

**Your turn** — closes the message. The actions only a human can take, numbered, each naming the thing to do and where to do it. When the list is empty, write **"Nothing — merged, deployed, and the checkout is clean."** and mean it. A user who cannot tell an empty list from a forgotten one has to go and check for themselves. Anything you are asking them to weigh is an item on this list, and reaching this section means it is already too late to be one — a report that says `Nothing` here and offers opinions up in the details is naming work the merge just made expensive.

What earns a line in the last two sections is what **changes what the user does next**. A check that went red and that you fixed changed nothing for them — that is detail. A deferred issue they now own, a failed deploy, a decision waiting on them, a dirty file you left untouched: those are theirs, and they go at the bottom where the eye lands first.

## Guardrails

- **The default branch is deployed by the pipeline.** A red deploy is fixed by a PR, never by pushing to the default branch or re-running a workflow with edited inputs.
- **A green merge is not a green deploy.** The gate and the deploy are different runs against different things; walking away at merge is how a broken production build goes unnoticed until someone opens the app.
- **The receipt is the proof.** No receipt means no completed deploy, whatever the run's colour suggested.
- **Preserve work you did not write.** The clean slate is about *this* task's leftovers. Uncommitted changes you cannot account for get reported, never stashed, reset or checked out over.

## Settings

This skill reads one setting `/up` `## Settings` defines — **Checkout** at § 3, shared with `/up-deliver` — and one of its own, **Deploy** at § 2. It acts on what they name, so it asks for each one that is missing. Each `###` heading below is one setting: its topic, its question, and its options. `/up-setup` reads the same headings to ask every setting up front.

1. **The settings home.** The `## Agent skills` block of the root `AGENTS.md` — or `CLAUDE.md`, whichever the project has — names where `up-*` settings live and in what form. With neither file present, first ask which to create, recommending `AGENTS.md`, which most agents read. With no such line, ask the user where to keep them, the default first:
   - **`docs/agents/<topic>.md`** (default) — one Markdown file per topic, one `##` heading per setting, named as the setting. Other headings in the file are the project's own notes.
   - **One file** — at a path the user names.
   - **Another form** — as the user describes it.

   Write their answer as one line in that block, creating the block when it is missing — for the default, `` `up-*` settings: `docs/agents/<topic>.md`, one heading per setting. ``
2. **The setting.** Read it at the settings home. Present: use it, and ask nothing.
3. **Missing.** Ask its question below, recommended answer first, with the follow-up its option needs. Write the answer at the settings home, tell the user where it went and that they can edit it there or through `/up-setup`, then continue.

### Deploy

Topic `deploy`. Question: *How does a merge reach production, and what proves it arrived?*

| Option | Follow-up | Recommend when |
| --- | --- | --- |
| **A deploy workflow** | Which workflow deploys which part of the project, which changes trigger it, and the receipt that proves a deploy finished — a release tag, a release commit, a version the live app reports | A workflow in `.github/workflows/` deploys on a push to the default branch |
| **A document** | The file and heading that describe the deploys | The agent files route deploys to a pipeline document |
| **None** | — | Nothing deploys on merge — a library, or a deploy run by hand. Ship ends at the merge and says so |
