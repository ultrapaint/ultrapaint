---
name: up-to-story
description: Writes the conversation up as one user story on the project's tracker. Use when work should become a tracked issue.
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# To Story

Synthesis, not interview. This skill takes what the conversation and the codebase already settled and writes it up as **one user story** on the project's tracker, governed by [`STORIES.md`](./STORIES.md).

**One goal, one story, one PR.** The goal is the outcome the user asked for, and the story carries everything reaching it takes — every layer, every edge, the tests and the translations. A large story reads as one piece of work on the tracker; four fragments of it read as noise around it.

A question you still need answered means the story is not ready to be written. Ask it, the way `/up` `## Working rules` says — one question at a time, each with your recommendation — and write once it is answered. Decisions that turn on each other go to [`/up-grill`](../up-grill/SKILL.md) first.

## 1. Gather what is settled

Work from the conversation. Where `/up-explore` produced a brief, that brief is the material: the provenance, the seams, the prior art, the decisions the user has since made.

Without one, run `/up-explore` now — the story names interfaces, test levels and prior art, and each of those is a fact about the codebase rather than a matter of taste. Its § 2 searches the tracker first: an issue that already describes the work is refined, never filed twice.

Check the request's premise too: the product, the area and the terms it names, against the glossary. A request that names the wrong one is corrected before anything is written (`/up` `## Working rules`).

Use the domain's own vocabulary throughout, from the project's glossary — `/up`'s [`DECISIONS.md`](../up/DECISIONS.md) says where it lives — and respect the ADRs in the area you are touching.

Done when every decision the conversation reached is listed in one place — the explore brief, or a summary you write in the chat now — and none is only implied.

## 2. Hold it to one goal

Name the goal in one sentence: the outcome the user asked for. Then hold everything the conversation settled against it.

- It all serves that goal: one story, however large. Go to step 3.
- Something serves a second goal — an outcome that would be asked for on its own, and worth shipping if the first never existed: that is a second story. Read [`SPLITTING.md`](./SPLITTING.md) before writing anything, because a set of stories has its own wiring.

Size, layers and readiness leave a story whole ([`STORIES.md`](./STORIES.md) `## Splitting`). A part still waiting on a decision holds the story until it is decided.

Done when the goal is named in one sentence, and every settled decision sits inside it or is named as a second goal.

## 3. Settle the seams

Sketch the seams the feature will be tested at, in the vocabulary of [`SEAMS.md`](./SEAMS.md). Prefer an existing seam to a new one, and the highest seam to a lower one. The fewer seams across the codebase, the better — one is the ideal.

Put them to the user and wait. A seam is an architectural decision that outlives the feature, so it is theirs. A seam the user already agreed — in their answers, a grilling, on the explore brief, or from [`/up-architect`](../up-architect/SKILL.md) — is named as agreed, not asked again. Where the seams are not obvious — new modules, several places they could go — `/up-architect` recommends them before you ask.

Done when the user has agreed the seams, or named different ones.

## 4. Write it

Write the body to [`STORIES.md`](./STORIES.md) `## The story body` — or `## Bugs` when the work is a bug. It is the **story** shape; epics and discovery tickets are written by hand, because no skill can ask its way to either.

Name each behaviour's test level from the **Test levels** setting when the settings home has one; without it, name the tool that runs the test. A level the project has no tool for yet is named anyway, and setting the tool up becomes part of the story.

Done when every accepted requirement appears in a user story, an implementation decision, a testing decision, or an out-of-scope note — anything appearing nowhere is an unrecorded decision, and it will be re-litigated in review.

## 5. Publish

Read the **Tracker**, **Labels** and **Scopes** settings now, per [Settings](#settings).

With **Tracker** at **None**, create nothing: print the story in the chat — its title and its body — for the user to keep, and say no issue was created. Skip **Labels** and the board, and name a blocking story in `## Blocked by` by its title.

- **Title**: the project's own title rule where its agent files or the **Scopes** document state one. Otherwise `<scope>: <description>`, the description a lowercase imperative phrase with no type in it — or the description alone, without scopes. Take the scope from the vocabulary, never from a guess: a scope missing from it is a review finding.
- **Labels**: the triage label, and stop there. Triage sets the label axes, and a ready label asserts a bar this skill cannot check, so it is triage's to apply. A label the tracker lacks is named in the report and left off.
- **Board**: where the project keeps one, leave its status alone. The tracker adds the item asynchronously, so anything set in the same breath races it. Getting the labels right is the whole job.

On GitHub, `gh issue create`, with a heredoc for the body. On another tracker, the way the **Tracker** setting describes.

**Refining an issue that already exists** — the one § 1 found, or a discovery body whose questions were just answered — rewrites its body in place instead (`gh issue edit <n> --body-file -`) and keeps its labels, unless the story's work is already on the default branch: that is frozen, and the change is a new issue ([`STORIES.md`](./STORIES.md) `## Frozen once live`).

Report the issue and its URL, then hand to [`/up-triage`](../up-triage/SKILL.md): it owns the axes and the ready label, and a story written to the bar passes it in one quick pass. `/up-implement` follows its **Ready** verdict.

Done when the issue exists with its title and the triage label — or, with **Tracker** at **None**, the story is printed with its title — and reads as something triage can mark ready with no further conversation.

## Settings

This skill reads four settings, all defined in `/up` `## Settings` together with the steps that find them:

- **Tracker**, **Labels** and **Scopes** at § 5. This skill writes the issue, its labels and its title, so it asks for each one that is missing.
- **Test levels** at § 4, and only when it is set: without it, the story names tools.
