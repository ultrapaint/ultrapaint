# Plan: DESIGN.md in the open format, kept in step with the code

Status: proposed, 2026-10-15. Decision in ADR 0027. Builds on 0024 (style systems) and 0025
(sync, values in the code, Figma matched against a baseline).

## Why

`DESIGN.md` is our own free prose in `docs/designs`. The open format
(`github.com/google-labs-code/design.md`, version `alpha`) is what Stitch exports, designers
write and agents outside the editor look for at the repository root. Today a repository's
`DESIGN.md` from elsewhere is invisible to us, and ours is useless to anything but our
briefing.

## Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Role | `DESIGN.md` is the design system's document; the code keeps the values; the front matter mirrors them both ways (option 2 of the review) |
| D2 | Location | The repository root (`paths.root`). The designs directory's file is still read; Sync offers to move it |
| D3 | Themes | The front matter has the default theme only; the body says how the others differ |
| D4 | Component tokens | Mirrored from the cva variants' classes, as the last phase, independent of the rest |
| D5 | Parsing and writing | Ours, pure, in `packages/design-md`, with the `yaml` package's `Document` API so comments and the order of keys survive a rewrite |
| D6 | Lint | `@google/design.md/linter`, pinned to an exact version, behind a `DesignMdLint` service |
| D7 | MCP | No new tool. `read_design_system` and `write_design_system` carry the document; `map_values` gets a kind `design` |

## Ownership of the file

| Part | Owner | What the editor does |
|---|---|---|
| `colors`, `rounded`, `spacing`, `typography`, `components` | the code | rewrites them when the code changes; a change made to them in the file goes through Sync |
| `version`, `name`, `description`, `omitted`, unknown keys | the file's authors | keeps them as they are; writes `version: alpha` and a `name` when the file is first made |
| the body | the file's authors and agents | keeps it as it is, except that token references are renamed after a match |

## Phases

Each phase ends with `pnpm typecheck`, `pnpm test` and `pnpm lint` passing. Phase 2 needs 1;
3 and 4 need 2; 5 needs 2; 6 needs only 1.

### Phase 1: `packages/design-md` (pure, no Effect)

1.1 **Read.** `parse(text)` returns:
- the front matter as a `yaml` `Document`, with the decoded groups;
- the body as a list of sections (heading, the alias it matched, its text);
- the problems found: front matter that is not valid YAML, an `##` heading given twice, a token
  of the wrong type.

`##` headings inside code fences do not count as sections. An `#` title is kept and is not a
section.

1.2 **Map to and from the neutral tokens** (`@ultrapaint/contracts/tokens`):
- `mirrorOf(tokens, textStyles)` gives the groups the code implies, as in ADR 0027's table.
- `sideOf(doc)` gives the document's tokens as a `TokenSide` (the shape `FigmaSide` already has:
  `kind`, `name` under the code's prefix, `values[""]`, and `variable` as the document path
  `colors.tertiary`).

Values are converted by rules:
- colours as the code writes them;
- dimensions in `px` or `rem` as written;
- `lineHeight` as a number when it is unitless;
- `letterSpacing` in `em`;
- `fontFamily` as the first family of the stack, without quotes;
- `fontWeight` as a number.

A value the format cannot hold is left out and listed.

1.3 **Write.**
- `withMirror(doc, mirror)` replaces the mirrored groups. Other keys, comments and the body stay
  as they are. Keys follow the format's order (`version`, `name`, `description`, then the
  groups).
- `create(mirror, { name })` makes a first file, with the eight section headings and nothing
  under them.
- `renameRefs(doc, renames)` renames `{colors.a}` to `{colors.b}` in the front matter and the
  body.

1.4 **Tests.**
- Round trips of three fixtures: the upstream examples (`atmospheric-glass`, `paws-and-paths`,
  `totality-festival`, copied under `fixtures/upstream/` with their Apache-2.0 notice) and a
  shadcn-style theme of our own.
- Parse, then rewrite with the same mirror, gives back the same text byte for byte.
- Unknown keys and sections survive, a `#` title survives, and code fences are not split.

1.5 **Lint spike** (timeboxed):
- Add `@google/design.md` at an exact version. Its build bundles its dependencies with bun.
- Check that `lint()` from `@google/design.md/linter` imports under Node and Vite SSR, how large
  it is, and that its zod 3 does not clash with anything.
- If it does not hold up, write our own checks for what we need: broken references, contrast of
  the component pairs, section order, a duplicate section.

Done when the fixtures round-trip, and `pnpm typecheck` passes with `design-md` depending only
on `yaml` and contracts.

**Done, 2026-10-15.** `packages/design-md`: `parse.ts`, `tokens.ts` (`groupsOf`,
`documentTokens`), `mirror.ts` (`mirrorOf`), `write.ts` (`withMirror`, `create`, `renameRefs`),
`values.ts` (colours, lengths, `var()` and `calc()` resolved). Deviations:

- **Dependencies.** It depends on `@ultrapaint/design-document` as well, for `tokenValues`. That
  is the same reading of a design system's values the preview uses.
- **Tokens in fenced `yaml` blocks** are read and written in place, beside the front matter.
  The format's linter reads them too. A group given in two blocks is a problem.
- **`renameRefs` renames inside code fences as well.** A fenced example of the document's own
  tokens would otherwise go stale.

What the lint spike found:

- **It holds up.** `@google/design.md@0.4.0`'s linter is one bundled 667 KB module that imports
  only Node's own. It lints a file in 10 to 35 ms. It passes, with no error or warning, the
  files `create` and `withMirror` write.
- **The server's bundle has to carry its configuration.** On its first lint it reads
  `spec-config.yaml` next to its own module. So `apps/server/scripts/build.ts` copies that file
  beside the bundle, or keeps the package external. Phase 2 does this, when it adds the
  dependency to the server.
- **It does not report two sections of the same name**, which the format calls an error.
  `parse` does.

### Phase 2: the file at the root, mirrored from the code

2.1 **Contracts.**
- `DESIGN_FILE = "DESIGN.md"`, at the repository root. `DESIGN_NOTES_FILE` is kept as the
  legacy name, read from the designs directory.
- `DesignSystemState.notes` becomes `document`:
  - `path` (repository-relative), `text` and `legacy` (true when it is the designs directory's);
  - `sections` (heading and text, for the panel);
  - `findings` (the linter's).
- `SyncBaseline` gets `designMd?: { at, code, doc, matches? }`. The keys are the same as
  Figma's, and the matches are by document path.

2.2 **`DesignSystemService`.**
- It reads the root file first and the legacy one second.
- It watches both (`pages-watcher.ts:180` watches the designs root today; the repository root's
  `DESIGN.md` is added).
- `get` parses and lints, cached under the file's stamp, as the code's tokens are.

2.3 **The mirror is written when the code changes.**
- When the code's tokens or the text styles change and the file is not legacy, the service
  works out the mirror.
- If the file's mirrored values equal the baseline's document side (nobody edited them), it
  rewrites the groups and moves the baseline.
- Otherwise it leaves the file alone and Sync reports it (phase 3).
- The write goes through `EditService` as one undo step. It is refused when the file changed
  since it was read, the same check `writeTokens` makes on a declaration's span.

2.4 **`write(designSystem, document?)`** takes the whole file.
- The mirrored groups are regenerated from the code before saving.
- A mirrored value given that differs from the code's is refused: "token values are the code's;
  change the stylesheet".
- A linter error refuses the write; warnings come back with the result.

2.5 **Sync's move step.** A legacy file and no root file put a step "Move DESIGN.md to the
repository root" in every case:
- the file is moved with `git mv` when git tracks it;
- the mirror is written into it, after the user sees the front matter it will get;
- one undo step.

Done when, in a project with a legacy file, Sync offers the move, the root file gets its front
matter, editing a colour in the panel rewrites `colors` in the file, and the body is untouched.

**Done, 2026-10-15.** `DesignSystemService` reads, lints, mirrors and places the document;
`DesignMdLint` wraps the linter; Sync has the `design-md` step; the server's bundle carries the
linter's `spec-config.yaml`. Tests: `apps/server/src/design-md.test.ts`. Deviations:

- **One agreement map, at `designMd` in `design-system.json`** rather than `sync.designMd`.
  `sync` is Figma's baseline, whose fields are required. When the document and the code agree,
  their value is the same, so one map of the agreed values, by path, is enough
  (`@ultrapaint/design-md/merge`).
- **Per token, not per file.** A value the code changed alone is written into the document even
  while another value the document changed is held. Without an agreement yet:
  - a document with no mirrored values takes them all;
  - one with values of its own is held whole, for phase 3 to match.
- **Undo.** The root `DESIGN.md` is the one file outside the designs directory the edit journal
  writes (`RepoPaths.isEditable`). Placing it and an agent's write are undo steps. The mirror's
  writes, and the agreement they move, go outside the history (`EditService.amend`), as a value
  edited in the panel does.
- **No `git mv`.** The move is the journal's, undoable, and git sees a rename once it is staged.
- **"Write DESIGN.md".** With a design system and no `DESIGN.md` anywhere, the same step writes a
  first one, its front matter filled in and the eight sections empty for `/sync describe`.
- **What an agent writes against the code's values is put back, not refused**, with a warning
  finding per value. The agent cannot change a value either way, and a refusal would cost it a
  turn.
- **The MCP budget.** The read and write tools' descriptions were cut to make room for
  `designMd`. They stand at about 15,974 of 16,000 characters.

### Phase 3: the document's tokens in Sync

3.1 **Generalise Figma's comparison to a source of tokens.**
- `FigmaSide`, `matchFigma`, `compareFigma` and `figmaChanges` (`design-system-sync-rules.ts`)
  become `TokenSide`, `matchTokens`, `compareTokens` and `tokenChanges`, with the source
  (`figma` or `design`) in the diff.
- The Figma names stay as aliases until their callers move.
- Contract types follow: `TokenMatch`, `TokenDiff`, `TokenDecision`. The outcome `figma-behind`
  becomes `source-behind`.

3.2 **The step `design-tokens`.**
- It is laid out when the document has mirrored values that differ from the code's, or tokens
  that are not matched.
- It uses the same view as Figma's tokens: rows by outcome, conflicts picked, matches changed
  row by row.
- Applying writes the code with `setTokens`, then rewrites the document in the code's names
  (`renameRefs`), then moves the baseline. That is one undo step for the stylesheet and the
  document together.

3.3 **Cases.**
- A `DESIGN.md` with tokens counts as an import, like a `.fig`. The cases `figma` and
  `figma-code` become `import` and `import-code`, with the sources in `SyncFacts`
  (`figma?`, `designMd?: { path, tokens, legacy }`).
- When both a `.fig` and a `DESIGN.md` are there, `design-tokens` comes first. A designer who
  wrote the document wrote the intent.

3.4 **Text styles.**
- A change to `typography` in the document is listed field by field: the style, the field, the
  code's value and the document's.
- `/sync design` has the agent decide each with the user: point the style at another token,
  change the token for every style that uses it, or add one.
- The agent writes the result with `write_design_system`, as Define does.

3.5 **`/sync design`.**
- The task prompt (`sync-tasks.ts`) lists:
  - the unmatched tokens with their values and where the body mentions them;
  - the code's tokens of the same kinds;
  - the changed text styles.
- The agent matches the tokens with `map_values`, kind `design`. The enum costs about ten
  characters of the MCP budget, so they come out of a description in the same commit
  (`mcp.test.ts`).

Done with a Stitch-style document (`surface-container-high`, `tertiary`, `body-md`) on a
shadcn app:
- rules match `primary` and value twins;
- the agent matches the rest;
- applying writes `@theme`, and the document comes back in the code's names with its prose's
  references renamed.

**Done, 2026-10-15.** Tests: `apps/server/src/design-md.test.ts` (a Stitch-style document on a
shadcn-shaped theme) and `design-system-sync-rules.test.ts`. Deviations:

- **Renamed, not aliased.** The comparison's contract types and RPCs are the source's, whichever
  it is: `TokenDiff` (its value in `source`), `TokenComparison` (with `source`),
  `TokenDecision` (`take: "source" | "code"`), and `sync.tokens` / `sync.match` / `sync.apply`
  with `source: "figma" | "design"`. `FigmaSide` stays as the shape of a source's token, and
  matching is Figma's, unchanged (`matchDocument` keys DESIGN.md's matches by path). The Sync
  view's step is `sync-tokens.tsx`, the same for both.
- **No new cases.** `figma` and `figma-code` keep their names. A `DESIGN.md`'s tokens are compared
  once there is a design system. Before that, Define reads the document (4.1). The step shows
  only while something is held.
- **Applying also:**
  - lists the tokens the code was given in `design-system.json` (`listTokens`, colours in the
    semantic group), because the front matter mirrors what the design system lists;
  - takes what was left out of the code out of the document;
  - keeps what is still unmatched as the document has it.
- **The matches are kept beside the agreement** (`designMd.matches`). Matches saved before
  anything is taken leave `at` at 0. That reads as nothing agreed yet, so the document is not
  filled in with the code's tokens while it is being matched.



4.1 **Task prompts.** `/init` (`commands.ts`), Define (`setup-tasks.ts`) and `/sync describe`
(`sync-tasks.ts`) replace "DESIGN.md: what the application is…" with a short guide to the eight
sections:
- what goes in each;
- `{colors.primary}` references in the prose;
- a specific reference rather than adjectives, after the format's philosophy;
- dark mode in Colors;
- the voice and the audience in Overview;
- which component to use for what in Components.

The text lives once in `task-text.ts`.

4.2 **A legacy body without the sections.** `/sync describe` reorganises it into the sections,
keeping what it says. An `##` heading the format does not know stays, after the known ones.

4.3 **MCP.**
- `read_design_system` returns `designMd` (the text) where it returned `notes`, and its
  `findings`.
- `write_design_system`'s `notes` becomes `designMd`, described as "the whole of DESIGN.md; the
  token groups are the code's and are filled in".
- The total must not grow; the budget test is the check.

4.4 **Briefing.**
- `conventionsOf` gives the body without the front matter (the briefing lists the tokens
  already).
- It says where the file is.
- The built-in skills' "DESIGN.md wins" wording stays.

4.5 **Skills** keep their role and order. The three that defer to `DESIGN.md` name the
section they defer to:
- `color.ts`: Colors;
- `content.ts`: the voice in Overview;
- `accessibility.ts`: any section, as now.

`skills.test.ts:203` writes the root file.

Done when `/init` on this repository writes a root `DESIGN.md` that the linter passes with no
error.

### Phase 5: the panel

5.1 The DESIGN.md tab shows the document by section, with an Edit action per section (a plain
markdown field in a popover, like the toolbar's) and the linter's findings above.

5.2 The Colors, Typography, Spacing and Radius tabs show their section's prose above the
tokens.

5.3 Settings shows where the file is. **Move to the repository root** is offered while it is
legacy.

5.4 Docs:
- the README's design-system section and command table;
- ADR 0015's amendment note;
- the ADR index.

### Phase 6: component tokens (optional, independent)

6.1 **The catalogue keeps the classes.** The catalogue extraction
(`framework-react-vite/src/catalogue-extract.ts`) keeps each cva variant member's classes, and
the base classes: `variantClasses: Record<variant, Record<member, string>>` in `ComponentMeta`.

6.2 **The style system reads them.** `StyleSystem` gets `componentStyle(classes)`, which gives
the tokens a list of classes sets:
- `backgroundColor`, `textColor`, `rounded`, `padding`, `height`;
- for Tailwind, `bg-primary` gives `color-primary`, `rounded-md` gives `radius-md`, `h-9` a
  dimension.

A class with no token (`bg-[#fff]`) is left out.

6.3 **The mirror writes `components`.** For each component the design system notes, it writes
`<name>` (base plus defaults) and `<name>-<member>` for the members of its variant axis that
changes colour (`variant`, `intent`, `color`), as references (`{colors.primary}`). Sizes are
`<name>-<size>`, with `height` and `padding`. The linter's contrast rule then checks the real
pairs.

6.4 **Changes made in the document.** A component token changed in the document is not written
back to the classes. Sync lists it for `/sync describe`. Classes are the code's to change.

## Risks

- **The format is `alpha`.** We pin the version we write and lint, and fixtures from upstream
  catch a change when we bump it.
- **YAML rewrites** can reformat what a person wrote. Only the mirrored groups are replaced, and
  the byte-for-byte round trip of 1.4 is the guard.
- **Two writers.** A person editing `DESIGN.md` while the code changes is the conflict case:
  the mirror is not written over an edit that has not been taken, and Sync shows both.
- **Text styles' values are resolved,** so the link to their tokens is lost in the document. 3.4
  keeps that decision with an agent and the user, not with rules.
- **The linter's configuration file** must travel with the server's bundle (see 1.5).
- **The MCP budget** is about 10 characters. 4.3 renames rather than adds, and 3.5's enum value
  needs a cut.
