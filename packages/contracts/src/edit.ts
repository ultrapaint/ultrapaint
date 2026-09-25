import { Schema } from "effect";
import { Json, RepoRelativePath, SourceLocation } from "./base.ts";

export const ImportSpec = Schema.Struct({
  /** Local name when it differs from the imported one: `import { Button as Action }`. */
  alias: Schema.optional(Schema.String),
  /** Module specifier, e.g. `@epicparty/ui-components/button`. */
  from: Schema.String,
  isDefault: Schema.optional(Schema.Boolean),
  /** The whole module under one name: `import * as Icons`. */
  isNamespace: Schema.optional(Schema.Boolean),
  /** Imported binding, e.g. `Button`. */
  name: Schema.String,
});
export type ImportSpec = typeof ImportSpec.Type;

/**
 * A top-level declaration an element needs where it lands: a helper component or a constant the
 * JSX refers to. Added only when the destination has no binding of that name yet.
 */
export const Declaration = Schema.Struct({
  code: Schema.String,
  name: Schema.String,
});
export type Declaration = typeof Declaration.Type;

export const EditOp = Schema.Union([
  /** Add and remove Tailwind utilities on the element's `className`. Conflicts are merged. */
  Schema.Struct({
    add: Schema.Array(Schema.String),
    kind: Schema.Literal("setClasses"),
    remove: Schema.Array(Schema.String),
    target: SourceLocation,
  }),
  /** Set (or remove with `null`) a JSX attribute with a literal value. */
  Schema.Struct({
    kind: Schema.Literal("setAttribute"),
    name: Schema.String,
    target: SourceLocation,
    value: Json,
  }),
  /** Replace the text children of the element. */
  Schema.Struct({
    kind: Schema.Literal("setText"),
    target: SourceLocation,
    text: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("delete"), target: SourceLocation }),
  Schema.Struct({ kind: Schema.Literal("duplicate"), target: SourceLocation }),
  /** Move the element to become the child of `into` at `index`. */
  Schema.Struct({
    index: Schema.Int,
    into: SourceLocation,
    kind: Schema.Literal("move"),
    target: SourceLocation,
  }),
  /** Insert JSX text as a child of `into` at `index`, adding imports if missing. */
  Schema.Struct({
    declarations: Schema.optional(Schema.Array(Declaration)),
    imports: Schema.Array(ImportSpec),
    index: Schema.Int,
    into: SourceLocation,
    jsx: Schema.String,
    kind: Schema.Literal("insert"),
  }),
]);
export type EditOp = typeof EditOp.Type;

export const EditRequest = Schema.Struct({
  /** Content hash the client last saw for the file; a mismatch is rejected as stale. */
  expectedHash: Schema.optional(Schema.String),
  op: EditOp,
});
export type EditRequest = typeof EditRequest.Type;

/**
 * Moves or copies an element to another place, in the same file or another one: what dragging
 * an element across the canvas does. The imports and helpers the element needs go with it.
 */
export const TransferRequest = Schema.Struct({
  /** Leave the element where it was and put a copy at the destination. */
  copy: Schema.Boolean,
  index: Schema.Int,
  into: SourceLocation,
  target: SourceLocation,
});
export type TransferRequest = typeof TransferRequest.Type;

export const EditResult = Schema.Struct({
  changed: Schema.Boolean,
  file: RepoRelativePath,
  formatted: Schema.Boolean,
  hash: Schema.String,
  /** Where the edited element now lives; positions can shift after formatting. */
  location: Schema.NullOr(SourceLocation),
  warnings: Schema.Array(Schema.String),
});
export type EditResult = typeof EditResult.Type;

export const UndoState = Schema.Struct({
  canRedo: Schema.Boolean,
  canUndo: Schema.Boolean,
  invalidated: Schema.optional(Schema.String),
  redoLabel: Schema.optional(Schema.String),
  undoLabel: Schema.optional(Schema.String),
});
export type UndoState = typeof UndoState.Type;

export const ElementSource = Schema.Struct({
  attributes: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      raw: Schema.String,
      value: Schema.NullOr(Json),
    })
  ),
  /** Raw `className` attribute value when it is a plain string literal. */
  className: Schema.NullOr(Schema.String),
  /** Whether the file is inside the designs directory. */
  editable: Schema.Boolean,
  location: SourceLocation,
  /** Tag or component name of the element. */
  name: Schema.String,
  /** Direct text content when all children are text. */
  text: Schema.NullOr(Schema.String),
});
export type ElementSource = typeof ElementSource.Type;

/**
 * One JSX element of a file, as the source has it rather than as it renders: which element it
 * is written inside of, and in which top-level declaration. The rendered tree cannot tell the
 * inside of a component from the children an instance was given; this can.
 */
export const OutlineElement = Schema.Struct({
  col: Schema.Int,
  /** Whether it is a child of its parent as such, rather than inside an expression there. */
  direct: Schema.Boolean,
  line: Schema.Int,
  /** Index of the element it is written inside of, or null for the root of a return. */
  parent: Schema.NullOr(Schema.Int),
  /** Top-level declaration it is written in; `default` for the default export. */
  scope: Schema.String,
});
export type OutlineElement = typeof OutlineElement.Type;

export const SourceOutline = Schema.Struct({
  /** Every JSX element of the file, in document order. */
  elements: Schema.Array(OutlineElement),
  hash: Schema.String,
});
export type SourceOutline = typeof SourceOutline.Type;
