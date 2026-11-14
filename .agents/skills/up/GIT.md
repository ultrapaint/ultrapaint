# Git

How the `up-*` skills name, commit, merge and catch up work. The project's own git rules — in its agent files, or the document they route to — add to these and win where they differ.

## Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `type(scope): description`, the type from the set `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `ci`, `style`, `perf`, `build`, `revert`.

- **Each commit stands alone**: its own subject, its own scope, and a body wherever the change needs explaining. Under a rebase merge every commit reaches the default branch as itself, and it is written for the reader who finds it there.
- Move and rename files with `git mv`, so history follows them.
- Validate before committing.
- Stage only your own changes. Work in the tree you did not write is somebody's, and it stays out of your commits.

## Naming an issue, a PR and a branch

One **scope** identifies a piece of work everywhere it appears — the issue, the PR and the branch — taken from the **Scopes** setting (`/up` `## Settings`). Read it once and you know which part of the project is moving.

| Artifact | Shape | Example |
| --- | --- | --- |
| Issue title | `<scope>: description` | `billing/invoices: send a reminder before an invoice falls due` |
| PR title | `type(<scope>): description` | `feat(billing/invoices): send a reminder before an invoice falls due` |
| Branch | `type/<scope-with-dashes>-short-slug` | `feat/billing-invoices-due-reminder` |

- **The scope is the same string on all three**, cased the way the project's rules case it.
- **The issue carries no type.** One issue can legitimately produce a `feat` PR and a `fix` PR, and a title that names a type would be wrong for one of them. The type lives on a label, where the project has a type axis.
- **The PR always carries a type**, the branch's dominant change.
- **The description is a lowercase imperative phrase** with no trailing period, and it reads the same on the issue and the PR. It does not restate the scope.
- **Commits inside the PR keep their own narrower scopes.** A `feat(billing/invoices)` PR may hold `feat(billing/api)` and `feat(billing/web)` commits: the PR names the feature, each commit names the layer it touches.

Without scopes, every shape drops its scope: `description`, `type: description`, `type/short-slug`.

## Merging

Merge the way the **Merge strategy** setting says (`/up` `## Settings`):

- **Rebase** — every commit lands on the default branch as itself, so the branch's history is the record. The PR title and body reach the default branch in no form at all: anything a reader of `git log` needs is in a commit message already. A review fix is a commit like any other, and is written as one.
- **Squash** — the PR becomes one commit, its subject the PR title and its body the PR body. The PR body is part of the record, and is written for the `git log` reader as well as the reviewer.
- **Merge commit** — the branch's commits land as themselves under a merge commit titled by the PR.

## Catching up with the default branch

**A branch catches up by a rebase onto `origin/<default>`.** A conflict with the default branch is the usual reason. Never merge the default branch into the branch: under a rebase merge the merge commit is dropped and the conflict comes back, and under any strategy it buries the branch's own changes in a merge nobody reviews.

```sh
git fetch origin <default>
git rev-parse HEAD                  # the old head SHA: it must match the PR's head
git rebase origin/<default>
```

Resolve each conflicting commit as the rebase stops on it, and continue until every commit is replayed. A resolution belongs to the commit that conflicted, so each commit still stands alone. Keep the rebase to conflict resolution: a review fix is its own commit, made on top of the rebased branch.

<!-- upstream: mattpocock/skills skills/engineering/resolving-merge-conflicts/SKILL.md (removed upstream at daa01d8) -->

Each stop, in order:

1. **Read the state** — `git status`, the conflicting files, and the commit being replayed.
2. **Find why each side changed.** Read the commit messages, then the PRs and issues behind them. A hunk resolved without knowing either intent is a guess.
3. **Resolve each hunk.** Keep both intents where they fit together. Where they cannot, keep the one that matches the default branch's later decision, and name the trade-off in your report. Add no behaviour neither side had.
4. **Run the checks** the change touches — `/up-implement`'s **Scoped check** setting where it is set, or the project's typecheck and tests — and fix what the resolution broke.
5. **Stage and continue** — `git add` the resolved files, then `git rebase --continue`.

Abort the rebase only when the user asks: a conflict is resolved, not walked away from.

The rebased head is a commit nobody has tested, so the project's full suite runs on the head you push. Push with a lease pinned to the old head SHA:

```sh
git push --force-with-lease=<branch>:<old-head-sha>
```

The pinned lease refuses the push when somebody pushed to the branch after you read it. A bare `--force-with-lease` checks against the remote-tracking ref, and any fetch since your read — yours, or an editor's in the background — may have moved that ref over a commit you never saw.
