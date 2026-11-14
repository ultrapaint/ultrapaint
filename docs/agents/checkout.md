# Checkout

Settings for the `up-*` skills that set up or clean up a checkout. The `## Settings` section of
each skill that reads one defines it.

## Checkout

One kind ([ADR 0089](../adr/0089-a-task-runs-in-a-worktree-of-its-own.md), and
[`docs/development.md`](../development.md) "Working in parallel"). The clone at
`~/Code/ultrapaint/ultrapaint` is never a checkout to work in: it stays on `main`.

| Kind | Recognised by | Setup | Cleanup |
| --- | --- | --- | --- |
| T3 worktree | A path under `~/.t3/worktrees/ultrapaint/` | Made by T3, whose setup script runs `pnpm install --frozen-lockfile --prefer-offline`. The work's branch, named to the standard, is cut in it from `origin/main` (`git switch -c <branch> origin/main`). | Stop any `pnpm dev` this thread started, by its own process group (`kill -INT -- -<pgid>`), never by name. Delete the merged branch on GitHub. Then ask the person: **Delete the worktree** in T3, or **Keep it**. |

A worker that `/up-deliver` starts in parallel gets a T3 worktree: a new thread in worktree mode
from `origin/main`.
