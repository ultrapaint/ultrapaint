# Splitting

Reached from [`/up-to-story`](./SKILL.md) step 2, when the conversation settled more than one **goal**. The bar is [`STORIES.md`](./STORIES.md) `## Splitting`; this file is how a set of stories is cut and wired.

Every issue carries fixed overhead — a branch, a PR, a suite run, a review, a merge — and every issue is one more line the tracker's readers have to place. A set is therefore as small as its goals: two goals, two stories. Bigger means more behaviour per story, never vaguer.

## Cut by goal

One story per goal, each carrying its goal whole: every layer, every edge, its tests and its translations. A finished story is demoable on its own, and would be worth shipping if its siblings never existed. Two stories that could only ever ship together are one story.

A set needs no parent. Two sibling stories, one blocking the other, are wired by the blocking edge alone; an epic exists only when the user wants the outcome tracked as one. A prerequisite nobody asked for that would not be asked for on its own is part of the story that needs it, not a second goal.

Where the goals depend on each other, give each story its **blocking edges** — the siblings that must close before it can start. Prefactoring that several goals share goes first: make the change easy, then make the easy change.

## Check it with the user

Present the set as a numbered list before publishing anything. Per story: the title it will carry, the goal it reaches, and what blocks it.

Then ask:

- Which goal does each story reach, and would it be asked for on its own?
- Should any two be one story?
- Does each depend only on stories that genuinely gate it?

Iterate until the user approves. A split nobody agreed to is a split that gets re-argued in review.

## Publish

In dependency order — blockers first, so each story's edges can name a real issue number.

- **Parent**, where the set has one: promote it to an epic and let its `## Stories` checklist be the children, or keep it a story with the children linked under it. Either way it stays open and otherwise untouched.
- **Without a parent**, each story takes the full story body from [`STORIES.md`](./STORIES.md).
- **Child body**: `## Parent` · `## What to build` · `## Acceptance criteria` · `## Testing Decisions` · `## Blocked by`. A child inherits its parent's problem and solution and does not repeat them — that is the one dependency `STORIES.md` permits, and it is safe only because the parent is still open.
- **Title**: the rule in [`/up-to-story`](./SKILL.md) § 5.
- **Labels**: the triage label, plus the parent's axis labels where they are obviously the same.
- **Parent link**: attach each child as a sub-issue (below). Where sub-issues are unavailable, put `Part of #<parent>` at the top of the child body and add it to the parent's `## Stories` checklist.
- **Blocking edges**: the tracker's native issue dependencies (below), matching each child's `## Blocked by`.
- **Board**: where the project keeps one, leave its status alone; the tracker adds the item.

On another tracker, each of these is done the way the **Tracker** setting describes.

**Completion criterion:** every child carries its title, the triage label, a parent link, native blocking edges matching its `## Blocked by`, and acceptance criteria someone could hold a running build against. Every goal the parent named has exactly one story, and no story in the set reaches less than a goal.

Then work the frontier one story at a time with [`/up-implement`](../up-implement/SKILL.md), clearing context between them.

## GitHub mechanics

These are reached rarely, so read them rather than recall them.

- **Sub-issue**: attach a child to its parent through GitHub's sub-issues endpoint (`gh api`).
- **Blocking edge**: `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`) — _not_ the `#number` or the `node_id`. GitHub reports `issue_dependencies_summary.blocked_by`, which counts open blockers only: that is the live gate. Where dependencies are unavailable, fall back to the `## Blocked by` list in the child body.
- **Reading the edges**: `gh api repos/<owner>/<repo>/issues/<n>/dependencies/blocked_by` lists what blocks an issue, and `…/dependencies/blocking` what it blocks.
- **Frontier**: the children with no open blocker. List the parent's open children and drop any with `issue_dependencies_summary.blocked_by > 0`.
