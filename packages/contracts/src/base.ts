import { Schema } from "effect";

export const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
export type NonEmptyString = typeof NonEmptyString.Type;

/** A path relative to the target repository root, posix separators. */
export const RepoRelativePath = Schema.String.check(
  Schema.isPattern(/^(?!\/)(?!.*\.\.)[^\0]*$/)
);
export type RepoRelativePath = typeof RepoRelativePath.Type;

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
