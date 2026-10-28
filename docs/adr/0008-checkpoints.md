# ADR 0008: Agent turn checkpoints

Status: accepted, 2026-09-17.

> Amended by [0039](0039-deep-modules-third-review.md), 2026-10-28 ([PLAN-architecture-3](../PLAN-architecture-3.md)
> step 2): a checkpoint is a ref of a `checkpoints` namespace in the tool's snapshot store
> (0031), a file unchanged between turns kept once, rather than one JSON file each; the last 30
> are still kept. It keeps no comments, and a revert goes through the undo journal as one step
> that undo takes back, as a snapshot's restore does (0019). Checkpoints in the old format are
> moved in when the server starts.

Before each agent turn the server snapshots every text file under the designs directory into
`~/.ultrapaint/checkpoints/<id>.json` (last 30 kept). A checkpoint can be diffed against the
current files and reverted as one unit. Git stash was rejected because `git stash create`
ignores untracked files and new screens are usually untracked.
