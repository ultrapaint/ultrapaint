import * as S from "effect/Schema";
import { Json, RepoRelativePath, SourceLocation } from "./base.ts";

export const ImportSpec = S.Struct({
  /** Imported binding, e.g. `Button`. */
  name: S.String,
  /** Module specifier, e.g. `@epicparty/ui-components/button`. */
  from: S.String,
  isDefault: S.optional(S.Boolean),
});
export type ImportSpec = typeof ImportSpec.Type;

export const EditOp = S.Union(
  /** Add and remove Tailwind utilities on the element's `className`. Conflicts are merged. */
  S.Struct({
    kind: S.Literal("setClasses"),
    target: SourceLocation,
    add: S.Array(S.String),
    remove: S.Array(S.String),
  }),
  /** Set (or remove with `null`) a JSX attribute with a literal value. */
  S.Struct({
    kind: S.Literal("setAttribute"),
    target: SourceLocation,
    name: S.String,
    value: Json,
  }),
  /** Replace the text children of the element. */
  S.Struct({ kind: S.Literal("setText"), target: SourceLocation, text: S.String }),
  S.Struct({ kind: S.Literal("delete"), target: SourceLocation }),
  S.Struct({ kind: S.Literal("duplicate"), target: SourceLocation }),
  /** Move the element to become the child of `into` at `index`. */
  S.Struct({
    kind: S.Literal("move"),
    target: SourceLocation,
    into: SourceLocation,
    index: S.Int,
  }),
  /** Insert JSX text as a child of `into` at `index`, adding imports if missing. */
  S.Struct({
    kind: S.Literal("insert"),
    into: SourceLocation,
    index: S.Int,
    jsx: S.String,
    imports: S.Array(ImportSpec),
  }),
);
export type EditOp = typeof EditOp.Type;

export const EditRequest = S.Struct({
  op: EditOp,
  /** Content hash the client last saw for the file; a mismatch is rejected as stale. */
  expectedHash: S.optional(S.String),
});
export type EditRequest = typeof EditRequest.Type;

export const EditResult = S.Struct({
  file: RepoRelativePath,
  hash: S.String,
  changed: S.Boolean,
  /** Where the edited element now lives; positions can shift after formatting. */
  location: S.NullOr(SourceLocation),
  formatted: S.Boolean,
  warnings: S.Array(S.String),
});
export type EditResult = typeof EditResult.Type;

export const UndoState = S.Struct({
  canUndo: S.Boolean,
  canRedo: S.Boolean,
  undoLabel: S.optional(S.String),
  redoLabel: S.optional(S.String),
  invalidated: S.optional(S.String),
});
export type UndoState = typeof UndoState.Type;

export const ElementSource = S.Struct({
  location: SourceLocation,
  /** Tag or component name of the element. */
  name: S.String,
  /** Raw `className` attribute value when it is a plain string literal. */
  className: S.NullOr(S.String),
  attributes: S.Array(S.Struct({ name: S.String, value: S.NullOr(Json), raw: S.String })),
  /** Direct text content when all children are text. */
  text: S.NullOr(S.String),
  /** Whether the file is inside the designs directory. */
  editable: S.Boolean,
});
export type ElementSource = typeof ElementSource.Type;
