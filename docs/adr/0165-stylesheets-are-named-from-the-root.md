# ADR 0165: the stylesheets are named from the repository's root, in `stylesheets`

Status: accepted, 2026-11-27. Amends 0024 (its name for the setting, `hostCss`).

## Context

The configuration named the application's stylesheets in `hostCss`, relative to
`<designsDir>/.ultrapaint`, the folder the preview was generated into before ADR 0034:
`apps/web/src/styles.css` was written `../../../apps/web/src/styles.css`. Every other path of the
configuration, and the user docs, name a path from the repository's root. Some places undid the
stored form before they showed it and some did not: the design-system setup handed agents the
`../../../` form, and Settings › Repository › Stylesheets edited it under a placeholder of
`src/index.css`, which named a file under `.ultrapaint` that does not exist (UP-244).

## Decision

**The stylesheets are `stylesheets`, each a file of the repository from its root
(`src/index.css`), or a package's stylesheet as it is imported (`@acme/ui/styles.css`).** The
settings the server runs with and the editor edits carry that form, so a stylesheet is named the
same way in the file, in Settings, in Sync, in what an agent is told and in the docs.

- **`hostCss` is read, never written.** One function (`stylesheetsOf`, contracts' `settings.ts`)
  reads a configuration's stylesheets: `stylesheets` when it is there, else each `hostCss` entry
  resolved from `<designsDir>/.ultrapaint` to the root, a package's kept as it is. With both,
  `stylesheets` wins. The next save writes `stylesheets` alone, as `ultrapaint.json` was renamed.
- A new field rather than a new meaning for the old one: telling the forms apart by a leading `../`
  would work, but one field would carry two meanings that a reader of the file cannot tell apart.
  `stylesheets` is the word Settings and the setup already used.
- The Tailwind adapter reads a stylesheet as a file of the root when one is there, and otherwise
  as a package's, looked up from the designs directory and then from the anchor.

## Consequences

- An older Ultrapaint finds no stylesheet in a configuration written by this one until it updates.
- No configuration version: the field stays top-level (ADR 0024), and reading `hostCss` covers
  the files written before. ADR 0024's move under a style system's section, with its version,
  moves `stylesheets`.
