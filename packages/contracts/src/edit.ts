import { Schema as S } from "effect";
import { Json, RepoRelativePath, SourceLocation } from "./base.ts";

export const ImportSpec = S.Struct({
  /** Module specifier, e.g. `@epicparty/ui-components/button`. */
  from: S.String,
  isDefault: S.optional(S.Boolean),
  /** Imported binding, e.g. `Button`. */
  name: S.String,
});
export type ImportSpec = typeof ImportSpec.Type;

export const EditOp = S.Union(
  /** Add and remove Tailwind utilities on the element's `className`. Conflicts are merged. */
  S.Struct({
    add: S.Array(S.String),
    kind: S.Literal("setClasses"),
    remove: S.Array(S.String),
    target: SourceLocation,
  }),
  /** Set (or remove with `null`) a JSX attribute with a literal value. */
  S.Struct({
    kind: S.Literal("setAttribute"),
    name: S.String,
    target: SourceLocation,
    value: Json,
  }),
  /** Replace the text children of the element. */
  S.Struct({
    kind: S.Literal("setText"),
    target: SourceLocation,
    text: S.String,
  }),
  S.Struct({ kind: S.Literal("delete"), target: SourceLocation }),
  S.Struct({ kind: S.Literal("duplicate"), target: SourceLocation }),
  /** Move the element to become the child of `into` at `index`. */
  S.Struct({
    index: S.Int,
    into: SourceLocation,
    kind: S.Literal("move"),
    target: SourceLocation,
  }),
  /** Insert JSX text as a child of `into` at `index`, adding imports if missing. */
  S.Struct({
    imports: S.Array(ImportSpec),
    index: S.Int,
    into: SourceLocation,
    jsx: S.String,
    kind: S.Literal("insert"),
  })
);
export type EditOp = typeof EditOp.Type;

export const EditRequest = S.Struct({
  /** Content hash the client last saw for the file; a mismatch is rejected as stale. */
  expectedHash: S.optional(S.String),
  op: EditOp,
});
export type EditRequest = typeof EditRequest.Type;

export const EditResult = S.Struct({
  changed: S.Boolean,
  file: RepoRelativePath,
  formatted: S.Boolean,
  hash: S.String,
  /** Where the edited element now lives; positions can shift after formatting. */
  location: S.NullOr(SourceLocation),
  warnings: S.Array(S.String),
});
export type EditResult = typeof EditResult.Type;

export const UndoState = S.Struct({
  canRedo: S.Boolean,
  canUndo: S.Boolean,
  invalidated: S.optional(S.String),
  redoLabel: S.optional(S.String),
  undoLabel: S.optional(S.String),
});
export type UndoState = typeof UndoState.Type;

export const ElementSource = S.Struct({
  attributes: S.Array(
    S.Struct({ name: S.String, raw: S.String, value: S.NullOr(Json) })
  ),
  /** Raw `className` attribute value when it is a plain string literal. */
  className: S.NullOr(S.String),
  /** Whether the file is inside the designs directory. */
  editable: S.Boolean,
  location: SourceLocation,
  /** Tag or component name of the element. */
  name: S.String,
  /** Direct text content when all children are text. */
  text: S.NullOr(S.String),
});
export type ElementSource = typeof ElementSource.Type;
