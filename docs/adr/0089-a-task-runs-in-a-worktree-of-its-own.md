# ADR 0089: A task runs in a worktree of its own, and lands on `main` by a push

Status: accepted, 2026-11-13.

## Context

Until today every Ultrapaint thread worked in the one checkout at `~/Code/ultrapaint`. Threads
ran side by side in it, and one thread's edits and staged files went into another's commits;
staging each file by name and `git commit --only` kept that down without ending it. A lab round
or a deck running from the checkout held it for hours, and a `pnpm dev` left behind by an ended
session held its ports.

T3 makes a git worktree per thread, in `~/.t3/worktrees/<project folder>/<branch>/`, and runs
the project's setup script in it. EpicParty already works this way: an outer folder that is not
a repository, the clone inside it on `main`, every task in a worktree.

## Decision

- **The layout.** `~/Code/ultrapaint/` is a plain folder. `ultrapaint/` inside it is the clone,
  the T3 project: always on `main`, kept at `origin/main` by T3's `autoPull`, and never edited.
  A task runs in `~/.t3/worktrees/ultrapaint/<branch>/`, on a `t3/<name>` branch from
  `origin/main`. The evals' data stays at `~/Code/ultrapaint-data`.
- **A worktree has its own** `node_modules`, installed by the setup script
  (`pnpm install --frozen-lockfile --prefer-offline`, hard links from the pnpm store) when T3
  makes it; its own `.ultrapaint/` for an editor dogfooding on it; and its own ports. Nothing
  is copied into it.
- **`pnpm dev`'s ports** stay derived from the checkout's path (4600 + (sha1[0] % 40) × 2, the
  editor on the next port), and when either port of that pair can't be listened on, on the
  address the server and Vite will use, `pnpm dev` takes the next free pair in 4600–4679, going
  round (`scripts/dev-ports.ts`). `ULTRAPAINT_PORT` and `ULTRAPAINT_WEB_PORT`, when given, win.
- **Landing**, with no PR: commit on the branch, `git fetch && git rebase origin/main`,
  `pnpm typecheck && pnpm test && pnpm lint`, `git push origin HEAD:main`. The worktree is
  deleted in T3 once its work is on `main`.
- **Long jobs** run from a worktree that stays until they end, or from `~/Code/ultrapaint-data`.
- `.gitignore` names Claude Code's worktrees as the folder they are, `.claude/worktrees/`.

## Consequences

- A thread's commit holds only its own work: other threads' edits are in other worktrees.
- Two threads' work meets at the rebase, not in the working tree; the second to push rebases
  again and reruns the checks.
- A worktree's `pnpm dev` may land on another pair than its path's when that one is taken, and
  so on another port from one run to the next; the ports are printed at start.
- Each worktree has its own `.ultrapaint/`: an editor dogfooding on one worktree does not see
  another's unsaved state.
