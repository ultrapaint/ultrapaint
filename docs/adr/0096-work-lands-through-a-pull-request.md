# ADR 0096: Work lands through a pull request, and the up-* skills carry the delivery route

Status: accepted, 2026-11-14. Amends 0089 (how a task lands on `main`).

## Context

Since ADR 0089 every task has landed on `main` by a rebase, the local checks and
`git push origin HEAD:main`, with no PR. Nothing outside the agent saw a change before it was on
`main`: CI ran after the push, and work was written up nowhere but its commits.

The `@epicparty/skills` pack, installed under the prefix `up` (`epicparty-skills.json`), is a
delivery route for coding agents: a request becomes a story on the tracker (`/up-to-story`), is
built test-first on its own branch (`/up-implement`), opened as a PR (`/up-to-pr`), watched to
merged (`/up-babysit`) and shipped (`/up-ship`). EpicParty works this way.

## Decision

- **Work lands through a PR**, rebase-merged, so every commit reaches `main` as itself. A story is
  one PR; a request without a story can be a PR of its own. A direct push to `main` is the
  exception, made only when the person asks for one.
- **The tracker is GitHub Issues** on `ultrapaint/ultrapaint`, an issue written `UP-<n>` and a
  PR `#<n>`, with role labels, the `area:*`, `priority:*` and `type:*` axes, and the Ultrapaint
  Board (`docs/agents/issue-tracker.md`).
- **CI's `check` job is the PR's evidence**: a required check on `main`, strict, so a PR merges
  only when its branch is up to date with `main` and `check` passed on that head. Repository
  admins bypass it for a direct push.
- **The `up-*` settings** live in `docs/agents/<topic>.md`, one heading per setting, and
  `/up-setup` asks or changes them.
- 0089 holds otherwise: a task still runs in a T3 worktree of its own, cut from `origin/main`.
  Commit subjects keep the `type: ` form of the root `AGENTS.md`, with no scope; the scope is on
  the issue title, the branch and the `area:*` label.

## Consequences

- A change is seen as a PR, with CI green on its head, before it is on `main`.
- Two threads' work meets at the PR's rebase onto `main`, as it met at the push before: once one
  PR merges, the other is behind, rebases, and its `check` runs again on the new base before it
  can merge, so no merged commit goes untested.
- Work that should start is a card a person drags into the board's `Queued` column, and
  `/up-deliver` starts at most three worker threads for it.
- A release is still made by hand (`docs/agents/deploy.md`): nothing deploys on a merge.
