---
name: up-implement
description: Builds one story on one branch — test-first, validated, reviewed, committed. Use when an issue is ready to build.
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# Implement

One story in, one committed branch out. `/up-implement` starts from a fresh context and the issue, and ends where [`/up-ship`](../up-ship/SKILL.md) picks up.

The story is the spec. Where it and your judgement disagree, the story wins until the user says otherwise — that disagreement is worth raising out loud, and it is never worth silently building the other thing.

## 1. Load the story

Fetch the issue **and its comments** — the comments often carry decisions the body never got. The tracker is the **Tracker** setting when the settings home has one, or GitHub when `gh repo view` finds the repo. Where the work arrived with no issue, say so and build from what the conversation settled.

Check this checkout before anything runs, the way `/up-deliver`'s worker § 1 does — clean, at `origin/<default>` — on the default branch, or a fresh branch with no commits past it — and set up for its kind per the **Checkout** setting where it is set. A checkout that fails is somebody's work: stop, name what fails, and change nothing. A worker `/up-deliver` started has done this already.

Then claim it: assign yourself — on GitHub, `gh issue edit <n> --add-assignee @me` — and, where the project keeps a board, move the item to the Building stage (`/up`'s [`BOARD.md`](../up/BOARD.md)). Write the status **before** cutting the branch, and re-read the item afterwards — the write is what claims the story against other workers, and an issue still reading as ready to start invites one of them to claim it too. A worker that does not see itself as the writer lost the race and stops here. Run directly, the user's request is the go-ahead: claim the story from whatever stage it is in. Hold it to the Ready bar ([`STORIES.md`](../up-to-story/STORIES.md) `## Ready`) all the same — a gap is an **open question** you raise before building, not a reason to stop.

Done when you can state the outcome, the seams, and the test level the story named.

## 2. Cut the branch

Name it per `/up`'s [`GIT.md`](../up/GIT.md) `## Naming an issue, a PR and a branch`. The type follows the issue's type label where the **Labels** setting defines a type axis and the label names a Conventional Commit type — `fix`, `refactor`, `chore` — and the change otherwise: a label such as `feature` or `improvement` is `feat` when the change adds behaviour, `fix` when it repairs it. Where the change contradicts the label — a defect fix labelled a chore — the change decides, and the hand-off names the mismatch. The scope follows the issue's title — from the **Scopes** vocabulary where the project has one.

Branch off the default branch unless the user asked to stack this on another, and link the branch to the issue: on GitHub, create it with `gh issue develop <n> --name <branch> --base <default> --checkout`; on another tracker, comment its name on the issue. The link is how `/up-deliver` finds a branch before its PR exists.

Done when you are on a fresh branch named to the standard, cut from an up-to-date base.

## 3. Route the standards

Before editing, read what governs the code you are about to touch:

- The project's agent files — `AGENTS.md` or `CLAUDE.md` — from the root to the nearest one to each path.
- Every standard and skill they route those paths to.
- The glossary and the ADRs for the area, per `/up`'s [`DECISIONS.md`](../up/DECISIONS.md), so the code speaks the domain's words. Where the story uses a word the glossary avoids, the code takes the glossary's term and the hand-off names the mismatch.

Then read the neighbouring implementation. The pattern already in the codebase beats the pattern you would invent, and matching it is what keeps the next agent able to navigate.

Done when every path you are about to touch has its routed standards and its neighbouring pattern named.

## 4. Map the coverage

Read the **Test levels** setting now, per [Settings](#settings).

**Every numbered user story in the issue gets its own test.** That list is the acceptance criteria (`/up-to-story`'s `STORIES.md` `## Writing the story sentence`), so a story with no test is a promise nothing holds the build to.

A body with no numbered stories — a bug, an older story — maps its `## Acceptance` lines, or the bug's expected behaviour, instead; a surface those miss gets its numbered story.

Write the map before editing anything — story → the surface that proves it → the level → the setup, data, auth and cleanup it needs. `## Testing Decisions` names the level for the behaviours it covers; this step decides the rest, by the "proves" column of each level.

A surface the goal needs that no numbered story covers — the person without permission, the thing that is absent — gets its numbered story on the issue now, and its row here. The body is working material until the merge (`STORIES.md` `## Frozen once live`).

A line no level can prove — installing on a real device, a third-party dashboard — is proven by hand: its row names the manual check, and the PR body reports it as evidence.

**Each story lands at exactly one level, the cheapest that can catch its defect.** Coverage bought twice is paid for on every gate run. A rule proved at a lower level is settled there, and the journey covers only what the person sees when the rule applies to them. [`TEST-VALUE.md`](./TEST-VALUE.md) decides whether a test earns its place and at which level; read it before writing a row you are unsure of.

Done when every numbered story has a row in the map naming its level and its setup, and no story appears at two levels.

## 5. Build it test-first

Build at the seams the story agreed, by [`TDD.md`](./TDD.md) — one red-green slice at a time, working the map row by row. Read it before the first test.

Test the externally observable behaviour, never the implementation. Reuse the fixtures, page objects and factories the suite already has, and copy the prior art the story pointed at rather than inventing a new test shape beside it.

Typecheck the package you are in with its own script, and run the single test file as you go, with the level's run command from **Test levels**; the full check comes next. A tight loop is what makes the slices cheap.

Done when every row of the map has a test that has been run, and every numbered user story reads true against the running code.

## 6. Validate

Read the **Scoped check** setting now, per [Settings](#settings), and run what it names for every part of the project the change touches. Review whatever a formatter changed.

A change to code that other parts depend on validates those parts too, not only the one you were aiming at — and so does a change that writes generated files into them.

Done when the check passes, or its failure is understood and fixed rather than worked around.

## 7. Review the diff

Run [`/up-code-review`](../up-code-review/SKILL.md) against the merge-base, and pass it the story as its spec — the issue with its comments, or what the conversation settled when there is none. It reviews on two axes: **Standards**, whether the code follows the project's documented rules, and **Spec**, whether it does what the story asked.

Fix the Standards findings. A Spec finding naming a missing requirement means the feature is not done — go back to step 4, give the requirement its map row, and build it, rather than carrying the gap into the PR.

Done when the diff has been reviewed and every finding is fixed or dispositioned with a stated reason.

## 8. Commit

Commit per [`GIT.md`](../up/GIT.md) `## Commits`: Conventional Commit subjects, each commit standing alone, written for the reader who finds it on the default branch.

Done when your work is committed and `git status` shows nothing of yours left behind.

## Hand off

Report the branch, the issue, what you built, the validation result, every **small fix** you committed, every larger finding, and every **open question** you are leaving — the calls you made *for* the user. Then [`/up-to-pr`](../up-to-pr/SKILL.md) opens the pull request, carrying the findings and the questions into its body, and [`/up-ship`](../up-ship/SKILL.md) carries it to merged and into production.

## Guardrails

- **The story's goal is this branch's scope, and a small fix rides along.** What the goal needs is built here and written into the story (step 4). A **small fix** the work turns up lands here as its own commit, and anything larger goes under **Found in passing** in the PR body. A **sibling** of the defect you are fixing is an **open question**: ask before it ships (`/up` `## Vocabulary`).
- **Validation is evidence.** Make the code satisfy the gate, and leave the gate's config alone.
- **A test you had to reach into the implementation to write is telling you the seam is wrong.** Raise it rather than reaching further.

## Settings

This skill asks for two **settings** when they are missing: **Test levels** at § 4, defined in `/up` `## Settings` and shared with the other skills that name a level, and its own **Scoped check** at § 6. Each `###` heading below is one setting: its topic, its question, and its options. `/up-setup` reads the same headings to ask every setting up front.

1. **The settings home.** The `## Agent skills` block of the root `AGENTS.md` — or `CLAUDE.md`, whichever the project has — names where `up-*` settings live and in what form. With neither file present, first ask which to create, recommending `AGENTS.md`, which most agents read. With no such line, ask the user where to keep them, the default first:
   - **`docs/agents/<topic>.md`** (default) — one Markdown file per topic, one `##` heading per setting, named as the setting. Other headings in the file are the project's own notes.
   - **One file** — at a path the user names.
   - **Another form** — as the user describes it.

   Write their answer as one line in that block, creating the block when it is missing — for the default, `` `up-*` settings: `docs/agents/<topic>.md`, one heading per setting. ``
2. **The setting.** Read it at the settings home. Present: use it, and ask nothing.
3. **Missing.** Ask its question below, recommended answer first, with the follow-up its option needs. Write the answer at the settings home, tell the user where it went and that they can edit it there or through `/up-setup`, then continue.

It also reads four settings `/up` `## Settings` defines — **Tracker** and **Checkout** at § 1, **Labels** and **Scopes** at § 2 — when they are set, and never asks for them: without them it uses GitHub where `gh repo view` finds the repo, and names the branch from the change.

### Scoped check

Topic `validation`. Question: *Which commands validate a change, by what it touches?*

| Option | Follow-up | Recommend when |
| --- | --- | --- |
| **A document** | The file and heading that hold the table | The agent files already have a validation section |
| **This table** | One row per kind of change — a package, a layer, root files — and the commands it runs, in order | The project has several packages or products with their own checks |
| **These commands** | The commands, in order, such as `pnpm lint`, `pnpm typecheck`, `pnpm test` — or one script that runs them all | One package: the same commands validate every change |

Propose the commands from the root and package `package.json` scripts, run with the package manager the lockfile names: format first, then lint, typecheck and tests, where each exists.

This is the fast run while building. **Full suite** (`/up`) proves the branch once, on its head commit, before the PR.
