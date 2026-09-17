# ADR 0008: Agent turn checkpoints

Status: accepted, 2026-09-17.

Before each agent turn the server snapshots every text file under the designs directory into
`~/.ultrapaint/checkpoints/<id>.json` (last 30 kept). A checkpoint can be diffed against the
current files and reverted as one unit. Git stash was rejected because `git stash create`
ignores untracked files and new screens are usually untracked.
