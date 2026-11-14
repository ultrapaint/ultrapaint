# Validation

Settings for the `up-*` skills that validate a change. The `## Settings` section of each skill
that reads one defines it.

## Typecheck

`pnpm typecheck`: the root tsconfig, then every package's own `tsc --noEmit`.

## Full gate

1. `pnpm format`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm pack:local`
6. `pnpm -F @ultrapaint/desktop run stage`

Steps 2 to 6 are what CI's `check` job runs.

## Scoped check

The rule of the root `AGENTS.md`, for every change, in order:

1. `pnpm format`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm lint`

## Full suite

CI runs it. The `check` job of [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs
on every pull request to `main`: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm pack:local`
and staging the desktop app (`pnpm -F @ultrapaint/desktop run stage`). Its passing on the PR's
head commit is the evidence, and the PR body carries no suite report.

`check` is to be a required status check on `main`, by a ruleset the person can bypass for a rare
direct push. **The ruleset is not made yet**: until it is, nothing on GitHub enforces the check,
and `/up-babysit` merges only on `check` green.
