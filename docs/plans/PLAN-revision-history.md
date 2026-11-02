# Plan: a revision history

Status: proposed, 2026-10-25. Builds on 0008 (checkpoints), 0019 (snapshots) and the snapshot
store of [PLAN-desktop](PLAN-desktop.md) Phase 0.4. Its ADR is written with Phase 1.

## Why

The designs have three kinds of history today, none of which answers "what did this look like an
hour ago, and who changed it":

- **Undo** (`EditService`): one step per action, in memory, bounded by `JOURNAL_LIMIT` and
  `JOURNAL_CHARS`, lost when the server stops.
- **Checkpoints** (0008): the designs directory's text files before each agent turn, the last 30,
  for reverting a turn.
- **Named snapshots** (0019): a whole copy of the designs' text, taken when asked.

Git, when there is one, keeps what was committed, which is not what was designed between
commits, and the tool no longer commits unless asked (PLAN-desktop D9). A revision history, as
Figma's version history, keeps every meaningful point on disk, says who made it, and opens,
compares and restores any of them.

## Decisions

| # | Decision | Choice |
|---|---|---|
| R1 | What a revision covers | Every file of the designs directory: pages, canvases, specs, the design system, assets (images by content, which checkpoints and snapshots leave out). Comments are not designs (0019) and stay out. An agent turn that changed code also records the code files it changed, so a turn is restored whole |
| R2 | Where | The snapshot store in the state directory: files by content hash (`objects/`), one manifest per revision naming each file's hash. An unchanged file costs nothing; a revision costs what it changed. Never in git; the state directory is ignored as it is today |
| R3 | Granularity | Two levels. **Undo** stays per action, in memory. **A revision** is either one agent turn, or a group of the user's own actions: a group closes after 60 seconds without an edit, after 50 actions, when an agent turn starts, or when the canvas changes. Files changed outside the editor (a pull, a code editor, another tool) are a revision of their own, "Changed outside the editor", when the watcher sees them |
| R4 | What a revision says | Who (you, by the display name; an agent by its name and its chat), when, and what: the labels of the undo steps inside it ("Padding changed", "Page renamed"), or the turn's request; the pages and specs it touched |
| R5 | Checkpoints | Become the turn revisions. "Revert this turn" restores the files the turn changed to the revision before it, as today; the checkpoint files are migrated once and removed |
| R6 | Named snapshots | Become names on revisions. A name keeps its revision from ever being pruned. The snapshot files are migrated once |
| R7 | Restoring | Whole, or one page or spec; through `EditService`, so a restore is one undo step and undone like any other. Restoring never deletes later revisions: it adds one, "Restored from …" |
| R8 | Keeping | Every revision of the last 24 hours, then one an hour for 7 days, one a day for 30 days, then named ones only; objects no manifest names are removed after pruning. A size limit in settings, 500 MB by default, prunes the oldest unnamed first |
| R9 | Storage modes | `managed` and `file` keep revisions; `ephemeral` keeps them in memory only and moves them with the session when it is saved (0010) |

## Phases

Each phase ends with `pnpm typecheck`, `pnpm test` and `pnpm lint` passing.

### Phase 1: recording

- [ ] 1.1 ADR: the revision history; 0008 and 0019 amended.
- [ ] 1.2 `RevisionService` on the snapshot store: `record`, `list`, `read`, `prune`; the manifest
      schema in contracts.
- [ ] 1.3 Grouping the user's actions (R3): `EditService` reports each committed step; the
      service closes a group by time, count, turn start or canvas change.
- [ ] 1.4 Agent turns: a revision before and after each turn, with the code files it changed
      (PLAN-desktop 0.3); "Revert this turn" on revisions; checkpoints migrated.
- [ ] 1.5 Outside changes from the watcher, debounced into one revision.
- [ ] 1.6 Keeping and pruning (R8), on start and every hour.

### Phase 2: the History panel

- [ ] 2.1 A History panel: revisions by day, who, when, what; the current state on top.
- [ ] 2.2 Comparing a revision with now: the pages and specs that differ, each with the node diff
      `/implement` already computes.
- [ ] 2.3 Restoring (R7): the whole revision, or one page or spec from its row.
- [ ] 2.4 Naming a revision; named snapshots migrated and shown as named revisions.

### Phase 3: seeing a revision

- [ ] 3.1 Opening a revision on the canvas, read-only: the editor draws its pages from the
      manifest instead of the files.
- [ ] 3.2 Side by side: a page as it was and as it is.

### Phase 4: with the Changes panel

- [ ] 4.1 The Changes panel's redesign (PLAN-desktop open question) folds into History: the
      revisions first; git's status, diff and commit beneath when git is there and its setting on.

## Open questions

- The grouping's numbers (60 seconds, 50 actions) are a first guess; they want trying.
- Whether a turn revision should also keep code files the turn did not write but the user changed
  at the same time.
- Whether revisions should ever leave the machine (shared history, a hosted version). For now
  they are local; what is shared is what git commits.
- Thumbnails per revision: the page PNGs (0026) exist per page, so a revision could keep the
  hashes of the PNGs it had, at little cost.
