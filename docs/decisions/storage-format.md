# Storage format checkpoint (E10.1)

Status: verdict, 2026-09-17. Reviewed after M5 against the epicparty repository.

## Question

Does TSX stay the canonical screen format, or do we define a text-based screen format with a
translation path?

## Evidence from the build

- **Edit reliability.** Every inspector operation (classes, attributes, text, delete,
  duplicate, move, insert with imports) is a surgical AST edit that touched only the intended
  attribute or element in every verified case; the repository formatter then normalised class
  order and import layout. Undo and redo restore exact prior content and detect external
  changes. The one failure mode is a computed `className` expression that is not `cn(...)`, which
  the tool refuses with a message instead of guessing.
- **Agent success.** Claude Code completed two edits on screen files from plain prompts with
  file attachments, in auto and manual permission modes, without any format instruction. Agents
  already know TSX; a bespoke format would need a prompt-side specification and would lose that.
- **Merge behaviour.** Screens and `canvas.json` are plain text with stable formatting; git diffs
  of inspector edits are one-attribute changes. No binary or generated artefacts are committed.
- **Review readability.** A reviewer sees the same TSX the product code uses, with design-system
  imports and Tailwind utilities that pass the repository's own lint rules.

## Costs observed

- Round trip of an inspector edit is about 0.7 s, dominated by running the repository formatter
  as separate processes, not by TSX itself. An in-process formatter would remove most of it.
- Source positions shift after formatting; the tool re-locates elements by structural index.
  This works but is a moving part a dedicated format would not need.

## Verdict

Keep TSX as the canonical format for v1. Do not build a translation layer now. Revisit only if
one of these happens: agents start producing screens the tool cannot map (dynamic JSX, heavy
composition), or a screen needs semantics TSX cannot carry (variants of one screen, per-frame
data). If that day comes, the format must remain text in the repository and compile to TSX.
