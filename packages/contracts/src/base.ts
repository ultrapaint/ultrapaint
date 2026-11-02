import { Schema } from "effect";

export const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
export type NonEmptyString = typeof NonEmptyString.Type;

/** A path relative to the target repository root, posix separators. */
export const RepoRelativePath = Schema.String.check(
  Schema.isPattern(/^(?!\/)(?!.*\.\.)[^\0]*$/)
);
export type RepoRelativePath = typeof RepoRelativePath.Type;

/**
 * An id the server makes a file or directory name of: a thread's, a Figma import's. Letters,
 * digits, `_` and `-`, as the server writes them; never a separator, nor a `..` that would name
 * something outside the directory it is joined to.
 */
const FILE_ID_RE = /^[A-Za-z0-9_-]+$/;
export const FileId = Schema.String.check(Schema.isPattern(FILE_ID_RE));

/**
 * A canvas: the designs directory itself (`""`), or a directory inside it by its path from
 * there. No segment is empty or starts with a dot, so none is `.` or `..`, none is absolute, and
 * none holds a backslash, which Windows reads as a separator.
 */
const CANVAS_ID_RE = /^(?:[^/\\.\0][^/\\\0]*(?:\/[^/\\.\0][^/\\\0]*)*)?$/;
export const CanvasId = Schema.String.check(Schema.isPattern(CANVAS_ID_RE));

export const Json: Schema.Codec<JsonValue> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.Array(Json),
    Schema.Record(Schema.String, Json),
  ])
);
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const Timestamp = Schema.Number;
