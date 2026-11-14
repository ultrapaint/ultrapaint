# Delivery

Settings for [`/up-deliver`](../../.agents/skills/up-deliver/SKILL.md). Its `## Settings`
section defines each one.

## Ready signal

A board column: `Queued` on the Ultrapaint Board. Only a person drags a card there
([`issue-tracker.md`](./issue-tracker.md) `## Project board`).

## Orchestration

Parallel threads the coordinator starts: one T3 worktree thread per story with T3 Code's
`create_threads`, from `origin/main` ([`checkout.md`](./checkout.md)), **at most 3 at once**.
