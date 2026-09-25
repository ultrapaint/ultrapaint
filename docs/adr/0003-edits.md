# ADR 0003: Edits

Status: superseded by 0015, 2026-09-25. Accepted 2026-09-17, confirming D5.

## Decision

`apps/server/src/services/source.ts` parses the file with `@babel/parser`, finds the JSX element
whose opening tag starts at the stamped line and column, and applies the change with
magic-string so untouched code keeps its bytes. Supported operations: `setClasses` (Tailwind
merge with `tailwind-merge`, then the formatter sorts), `setAttribute` (literal kinds, removal),
`setText`, `delete` (drops unused imports), `duplicate`, `move`, `insert` (adds imports).

After the write the target repository's formatter runs. For Biome repositories the default is
`biome lint --write --unsafe --only=nursery/useSortedClasses --only=correctness/noUnusedImports`
followed by `biome format --write`; a full `biome check` costs seconds with type-aware rules.
The edited element is re-located after formatting by its pre-order index among JSX elements,
which formatting cannot change, and the new location is returned to the editor.

Writes are atomic and serialised per file. An `expectedHash` mismatch is rejected as stale. The
undo journal stores before and after contents and is invalidated by external changes.

## Measured

Inspector edit to visible change on the reference machine: about 0.7 s, of which two Biome
process launches are about 0.6 s. The 300 ms budget in the work definition is not met while
the formatter runs as a separate process; Biome's daemon mode did not help.
