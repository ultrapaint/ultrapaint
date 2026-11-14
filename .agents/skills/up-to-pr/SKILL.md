---
name: up-to-pr
description: Opens a pull request from a committed branch, carrying its suite report and issue link. Use when a branch is ready for review.
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# To PR

One branch in, one open PR out. The counterpart to [`/up-to-story`](../up-to-story/SKILL.md): that one writes the issue a human reads before the work, this one writes the PR a human reads during it.

**Who reads the PR body depends on the merge.** Under a rebase or merge-commit merge, every commit lands on the default branch as itself, and the body is for reviewers and nothing else: anything a reader of `git log` will need has to be in a commit message already. Under a squash, the body becomes the commit body, and is written for that reader too (`/up`'s [`GIT.md`](../up/GIT.md) `## Merging`).

## 1. Pin the branch

Establish the branch, its base, and that there is something to review:

- The base is the repo's default branch, unless the user asked to stack this on another.
- Commits exist on the branch that the base does not have.
- The working tree is clean. Uncommitted work is either part of this PR — commit it per `GIT.md` `## Commits` — or it is not yours, and it stays where it is.
- Check whether a PR is already open for this branch. There is, and this skill is done: hand to [`/up-babysit`](../up-babysit/SKILL.md).

Done when you can name the branch, the base, and the commits the PR will carry.

## 2. Find the issue it closes

The user may have named it. `/up-implement` will have. Where neither did, search the tracker for the work's provenance with the branch's own nouns — on GitHub, `gh issue list --search "<keywords>" --state all` — and judge each hit against the branch: the same work is the issue, adjacent work is context. The tracker is the **Tracker** setting when the settings home has one, or GitHub when `gh repo view` finds the repo.

An issue found here is named in the body so that merging the PR closes it — `Closes #<n>` on GitHub, or the form the **Tracker** setting gives — and the board, where there is one, follows on its own. A PR that lands one stage of a story that continues — a schema widen ahead of its narrow — names it as a part instead, `Part of #<n>` on GitHub, and the last stage closes it (`/up-to-story`'s `STORIES.md` `## Splitting`). Work with genuinely no issue says so in the body rather than having one invented for it.

With an issue to name and no **Tracker** setting, ask for it now, per [Settings](#settings): the PR body is about to write the link.

Done when you have the issue, or have searched and can say there is none.

## 3. Validate the head commit

Read the **Full suite** setting now, per [Settings](#settings).

- **CI runs it** — nothing runs here. The required checks on the head commit are the evidence, and `/up-babysit` reads them.
- **Any other option** — run what it names for what the branch touches, on the head commit. **You are the check**, and step 4 reports what you found.

Note the SHA you ran it against. A suite result belongs to one commit, and it stops being evidence the moment another lands.

Done when the suite has run and you can name its result and the SHA it judged, or state the concrete reason it could not run — or the setting leaves it to CI.

## 4. Write it

Read the **Scopes** setting when it is set, and the **Merge strategy** setting now, per [Settings](#settings): it decides who reads the body.

**Title** — the conventional-commit subject that summarises the whole branch, per `GIT.md` `## Naming an issue, a PR and a branch`: `type(<scope>): description`, the scope matching the issue's, the type the branch's dominant change. Individual commits keep their own narrower scopes.

**Body** — check for a template first (`.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE/`) and fill its headings when one exists. Otherwise write prose covering:

- **Why this exists** — the problem, in the reviewer's terms. One or two sentences; the issue holds the long version.
- **What it does** — the change, at the level of behaviour rather than file-by-file. A reviewer reads this to know where to look.
- **What to look at** — the decision you are least sure of, the trade-off you made, the file that carries the risk. This is the section that gets you a useful review instead of an approval. Label as **Open question** each call you made *for* the user and would change on their word (`/up` `## Vocabulary`); `/up-babysit` holds the merge until each has an answer, so one left unlabelled ships as decided.
- **Found in passing** — each **small fix** the branch carries, named by commit, and each larger finding left for the user to make a story of (`/up` `## Vocabulary`). Leave the heading out when there is neither.
- **The suite report** — the command you ran, the SHA, and the result. Say plainly when it could not run. Leave it out when CI runs the suite.
- **The issue link** from step 2.

Use the domain's own vocabulary ([`DECISIONS.md`](../up/DECISIONS.md)), name other issues with the **Tracker** setting's prefix, and follow the naming rules the project's agent files set for prose. Under a **Squash** merge, write the body as the commit body it becomes: lead with what `git log` needs, and keep the reviewer's notes — what to look at, the open questions — under their own headings below it.

Done when a reviewer who has not seen the issue would know why the branch exists and where to start reading.

## 5. Open it

Push the branch, then open the PR against the base — **ready for review, not a draft**. A draft can never reach the gate, and a PR nobody was asked to review is a PR that sits.

Then, where the project keeps a board, move the issue to the Review stage (`/up`'s [`BOARD.md`](../up/BOARD.md)). Do it now rather than after CI goes green: review covers "PR open, awaiting CI and review", so an amber build belongs there too.

Report the PR number and URL, then hand to [`/up-ship`](../up-ship/SKILL.md), which sweeps it to merged and follows it into production.

Done when the PR is open, non-draft, based correctly, linked to its issue, and the board — where there is one — reads review.

## Guardrails

- **A PR body is a summary, never a substitute.** The commits are the record that reaches the default branch; when the body is the only place something is explained, the explanation is in the wrong place.
- **The suite report names a commit.** A report without a SHA reads as reassurance rather than evidence, and where CI does not run the suite it is the only evidence the PR has.
- **The story's goal is the PR's scope.** Work you notice that the goal needs lands as a commit, and step 3 runs again on the new head. A **small fix** lands as a commit too, even when the goal does not need it. Anything larger goes under **Found in passing**, and the user decides whether it becomes a story. A **sibling** of the defect the branch fixes goes in the body as an **open question**, for the user to answer before the merge (`/up` `## Vocabulary`).

## Settings

This skill reads four settings, all defined in `/up` `## Settings` together with the steps that find them:

- **Full suite** at § 3 and **Merge strategy** at § 4. This skill runs the one and writes the body the other shapes, so it asks for each one that is missing.
- **Tracker** at § 2: read when set, and asked for only when there is an issue to link.
- **Scopes** at § 4, when it is set.
