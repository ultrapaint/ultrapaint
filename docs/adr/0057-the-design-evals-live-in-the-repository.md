# ADR 0057: The design evals live in the repository, their data outside it

Status: accepted, 2026-11-03.

## Context

The design evals, which measure the design skill by having agents remake good screens, lived in a
lab repository beside Ultrapaint. It reached Ultrapaint through a symlink to a checkout, a pinned
clone (`.checkout`) and `ULTRAPAINT_CHECKOUT`, and linked its dependencies from that checkout's
`node_modules`. When the editor's RPC group was renamed, the lab stopped starting rounds and
nothing said so until a round was run. Its prompts kept their own copy of what the product's tasks
tell agents, and drifted from it.

## Decision

- The evals' code and prompts are a workspace package, `evals/` (`@ultrapaint/evals`), run as
  `pnpm evals`. It reaches Ultrapaint as before, through the `ultrapaint` command and the wire
  contracts only, and is typechecked and linted with the rest.
- Its data stays out of git: references and their captures, hosts, rounds, the studies' corpus.
  It is `ULTRAPAINT_EVALS_DATA`, else `~/Code/ultrapaint-data`.
- A round measures the checkout the command runs from; another commit is a worktree named by
  `ULTRAPAINT_CHECKOUT`. The pinned clone and the symlink go.

## Consequences

- A change to the contracts that breaks the evals fails `pnpm typecheck`.
- A skill change can be measured from its own branch, before it is merged.
- The evals have no tests yet, and `pnpm test` does not run them.
