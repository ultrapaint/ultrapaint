import { Schema as S } from "effect";

export const NonEmptyString = S.String.pipe(S.minLength(1));
export type NonEmptyString = typeof NonEmptyString.Type;

/** A path relative to the target repository root, posix separators. */
export const RepoRelativePath = S.String.pipe(
  S.pattern(/^(?!\/)(?!.*\.\.)[^\0]*$/)
);
export type RepoRelativePath = typeof RepoRelativePath.Type;

/** Location of a JSX element in the target repository. */
export const SourceLocation = S.Struct({
  col: S.Int.pipe(S.nonNegative()),
  file: RepoRelativePath,
  line: S.Int.pipe(S.positive()),
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

export const Json: S.Schema<JsonValue> = S.suspend(() =>
  S.Union(
    S.Null,
    S.Boolean,
    S.Number,
    S.String,
    S.Array(Json),
    S.Record({ key: S.String, value: Json })
  )
);
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const Timestamp = S.Number;
