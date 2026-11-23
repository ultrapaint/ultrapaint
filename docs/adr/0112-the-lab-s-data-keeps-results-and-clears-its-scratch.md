# ADR 0112: The lab's data keeps its results and clears its scratch

Status: accepted, 2026-11-23.

## Context

The lab's data directory (`~/Code/ultrapaint-data`, outside git) had no rule for what stays. By
23 November its `.work/` held 56 GB, 54 of them in `.work/outside/`, the apps of outside runs kept
so their pictures can be taken again (`pnpm evals reshoot`). A run's app starts with a link to its
host's packages, and in 334 runs of 645 the agent installed its own over it, about 160 MB each,
nearly always adding a package the host lacks (an icon set, a face). Lab checkouts stayed too:
fifteen worktrees of the repository under `.work/`, each made for a round or a capture, most with
their results long on `main`. Nothing said which of them anything still reads, so nothing was
removed, and the same will happen to every round from now on.

## Decision

- **Everything outside `.work/` is a result, or what a result reads, and stays**: `runs/`, the
  gaps' pictures and sections, the candidates, the decisions, the references and their captures,
  the hosts, the corpus and the studies. A round's record (`round.json`, `recall.json`) and its
  skill trees are what make it readable later (ADR 0069).
- **`.work/` is scratch.** Three things in it go once nothing reads them:
  - a finished outside run's own install of its packages: its source stays, and `reshoot`
    installs it again from the run's `package.json` before it pictures the app;
  - a lab checkout (a worktree of the repository in `.work/`, detached) whose every change is on
    `main`: a result line counts as there when `main`'s file names its round, since a line is
    reworded when it is carried over. A checkout on a branch, with files git does not track, or with
    a line `main` lacks is kept, and `tidy` says why;
  - a long job's log, and the process group it wrote down, 30 days after it was last written.
- **`pnpm evals tidy` applies it.** It lists what would go; `--apply` removes it, and refuses while
  a `lab-*` unit runs, since a job may be reading it.
- **A checkout is removed by the thread that made it** once the round's results land: `tidy`
  catches what is left.

## Consequences

- About 51 GB come back on the first run. A reshoot of an old outside round now installs each
  run's packages first, which takes the network or npm's cache.
- What `tidy` keeps it names with the reason, so a checkout holding results that never reached
  `main` is seen rather than lost.
- Logs older than 30 days are gone: a job's outcome is in its round's report, the gaps and the
  thread it reported to.
