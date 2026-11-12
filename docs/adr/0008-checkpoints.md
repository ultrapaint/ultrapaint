# ADR 0008: Agent turn checkpoints

Status: accepted, 2026-09-17.

> Replaced by [0087](0087-the-designs-history-is-ultrapaints-and-git-is-apart.md), 2026-11-12: an
> agent's turn is a point of the designs' history, taken when it ends, the person's edits closed
> into a point of their own before it; nothing is let go of. The checkpoints kept were brought in.

> Amended 2026-11-10: checkpoints in the old format are no longer imported. That format was
> replaced before the first release (v0.1.0, 2026-11-08), and no state on the machines the tool
> ran on still held it.

> Amended by [0039](0039-deep-modules-third-review.md), 2026-10-28 ([PLAN-architecture-3](../plans/done/PLAN-architecture-3.md)
> step 2): a checkpoint is a ref of a `checkpoints` namespace in the tool's snapshot store
> (0031), a file unchanged between turns kept once, rather than one JSON file each; the last 30
> are still kept. It keeps no comments, and a revert goes through the undo journal as one step
> that undo takes back, as a snapshot's restore does (0019). Checkpoints in the old format are
> moved in when the server starts.

Before each agent turn the server snapshots every text file under the designs directory into
`~/.ultrapaint/checkpoints/<id>.json` (last 30 kept). A checkpoint can be diffed against the
current files and reverted as one unit. Git stash was rejected because `git stash create`
ignores untracked files and new screens are usually untracked.
