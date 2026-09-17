import { Schema } from "effect";

export const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
export type NonEmptyString = typeof NonEmptyString.Type;

/** A path relative to the target repository root, posix separators. */
export const RepoRelativePath = Schema.String.check(
  Schema.isPattern(/^(?!\/)(?!.*\.\.)[^\0]*$/)
);
export type RepoRelativePath = typeof RepoRelativePath.Type;

/** Location of a JSX element in the target repository. */
export const SourceLocation = Schema.Struct({
  col: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  file: RepoRelativePath,
  line: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type SourceLocation = typeof SourceLocation.Type;

export const sourceKey = (loc: SourceLocation): string =>
  `${loc.file}:${loc.line}:${loc.col}`;

export const parseSourceKey = (key: string): SourceLocation | null => {
  const idx = key.lastIndexOf(":");
  const idx2 = key.lastIndexOf(":", idx - 1);
  if (idx < 0 || idx2 < 0) {
    return null;
  }
  const file = key.slice(0, idx2);
  const line = Number(key.slice(idx2 + 1, idx));
  const col = Number(key.slice(idx + 1));
  if (!(file && Number.isInteger(line) && Number.isInteger(col))) {
    return null;
  }
  return { col, file, line };
};

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
