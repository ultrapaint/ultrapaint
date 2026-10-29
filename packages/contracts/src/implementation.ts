/**
 * The link between a design and the code that implements it (ADR 0030). `implementation.json` in
 * the designs directory keeps, per page and per component (ADR 0041), whether it is ready to be
 * implemented and, once it is, the files that implement it with the hashes of both sides then;
 * the design as it was implemented is kept beside it, in `_implemented/`, for the next
 * implementation to be told what changed. Both are committed.
 */
import { Schema } from "effect";

export const IMPLEMENTATION_FILE = "implementation.json";
/**
 * Where the designs as they were implemented are kept, inside the designs directory: a directory
 * starting with `_`, which the page scan passes by.
 */
export const IMPLEMENTED_DIR = "_implemented";

/**
 * What a binding is for: a page, by its id (`redesign/orders.page.json`), or a component, by its
 * name (`component:Button`).
 */
export const ImplementationTarget = Schema.String.annotate({
  description:
    'A page by its id ("orders.page.json", "redesign/orders.page.json") or a component as "component:<Name>".',
});

export const COMPONENT_TARGET_PREFIX = "component:";
export const componentTarget = (name: string) =>
  `${COMPONENT_TARGET_PREFIX}${name}`;
export const isComponentTarget = (target: string) =>
  target.startsWith(COMPONENT_TARGET_PREFIX);
export const IMPLEMENTED_COMPONENTS = "components";

const PAGE_FILE_RE = /\.page\.json$/;

/**
 * Where the design as it was implemented is kept, inside the designs directory:
 * `_implemented/orders.implemented.json` for `orders.page.json`,
 * `_implemented/components/Button.implemented.json` for `component:Button`.
 */
export const implementedFileOf = (target: string) =>
  `${IMPLEMENTED_DIR}/${
    isComponentTarget(target)
      ? `${IMPLEMENTED_COMPONENTS}/${target.slice(COMPONENT_TARGET_PREFIX.length)}`
      : target.replace(PAGE_FILE_RE, "")
  }.implemented.json`;

/** A design as it was implemented: when, by which files, and both sides' hashes then. */
export const Binding = Schema.Struct({
  /** When it was marked implemented, in milliseconds. */
  at: Schema.Number,
  /** Each file's hash then, by its repository-relative path. */
  code: Schema.Record(Schema.String, Schema.String),
  /** The design's hash then, its behaviour notes included. */
  design: Schema.String,
  /** Repository-relative, posix. */
  files: Schema.Array(Schema.String),
});
export type Binding = typeof Binding.Type;

export const ImplementationEntry = Schema.Struct({
  implemented: Schema.optional(Binding),
  /** The design is ready to be implemented. */
  ready: Schema.optional(Schema.Boolean),
});
export type ImplementationEntry = typeof ImplementationEntry.Type;

/** Contents of `implementation.json`. */
export const ImplementationFile = Schema.Struct({
  items: Schema.Record(Schema.String, ImplementationEntry),
  version: Schema.Literal(1),
});
export type ImplementationFile = typeof ImplementationFile.Type;

/**
 * - `draft`: not bound, not marked ready.
 * - `ready`: marked ready to be implemented.
 * - `implemented`: bound, and neither side changed since.
 * - `changed`: bound, and the design, the code or both changed since (`designChanged`,
 *   `codeChanged`).
 */
export const ImplementationStatus = Schema.Literals([
  "draft",
  "ready",
  "implemented",
  "changed",
]);
export type ImplementationStatus = typeof ImplementationStatus.Type;

export const ImplementationItem = Schema.Struct({
  /** When it was implemented, when it was. */
  at: Schema.optional(Schema.Number),
  /** The files that changed since, or are gone. */
  changedFiles: Schema.Array(Schema.String),
  codeChanged: Schema.Boolean,
  designChanged: Schema.Boolean,
  /** The files that implement it. */
  files: Schema.Array(Schema.String),
  kind: Schema.Literals(["page", "component"]),
  /** What the editor calls it: the page's name, the component's. */
  name: Schema.String,
  ready: Schema.Boolean,
  status: ImplementationStatus,
  target: Schema.String,
  /**
   * The design system's tokens the design relies on whose value has not reached the code (ADR
   * 0028): changed in the design alone, waiting for an export, or changed on both sides. Left
   * out when there are none. The code does not draw the design faithfully until they are brought
   * over.
   */
  tokens: Schema.optional(Schema.Array(Schema.String)),
});
export type ImplementationItem = typeof ImplementationItem.Type;

export const ImplementationList = Schema.Struct({
  items: Schema.Array(ImplementationItem),
});
export type ImplementationList = typeof ImplementationList.Type;

/** What changed in a design since it was implemented, in lines an agent or a person reads. */
export const ImplementationChanges = Schema.Struct({
  /** Nothing changed in the design since. */
  empty: Schema.Boolean,
  /** Whether it was implemented at all; when not, `text` says so. */
  implemented: Schema.Boolean,
  text: Schema.String,
});
export type ImplementationChanges = typeof ImplementationChanges.Type;
