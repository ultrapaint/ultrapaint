/**
 * What every MCP tool of the editor shares: the failure it reports, the way it reports one, and
 * the parameter shapes that keep the tools' schemas short for the agent that reads them.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import { Effect, Schema } from "effect";

/**
 * What a tool says when it cannot answer: the reason, in words the agent can act on. An error
 * class, not a plain struct: the MCP server passes a failure's message to the agent only when it
 * is an `Error`, and says "internal server error" for anything else.
 */
export class ToolFailure extends Schema.TaggedError<ToolFailure>()(
  "ToolFailure",
  {
    message: Schema.String,
  }
) {}

/**
 * A parameter an agent may leave out. `optionalKey`, not `optional`: the latter also takes
 * `undefined`, which JSON Schema can only say as `null`, and every optional field of every
 * tool would carry an `anyOf` the agent pays for and never needs.
 */
export const opt = Schema.optionalKey;

/** A number an agent passes. Plain `Number` also admits "NaN" and "Infinity" as strings. */
export const finite = (minimum: number, maximum: number) =>
  Schema.Finite.check(Schema.isBetween({ maximum, minimum }));

/**
 * JSON an agent passes, which the handler validates itself and says what is wrong. `Json`
 * would describe itself to the agent as a recursive schema of every JSON value.
 */
export const AnyJson = Schema.Unknown;

/**
 * Every failure reaches the agent as a sentence it can do something about: no project open, a
 * route that does not exist, a component that is not in the catalogue.
 */
export const reported = <A, E extends { readonly message: string }, R>(
  effect: Effect.Effect<A, E, R>
) =>
  Effect.mapError(
    effect,
    (error) => new ToolFailure({ message: error.message })
  );

export const missing = (message: string) =>
  Effect.fail(new ToolFailure({ message }));

/** Documents and the design system are JSON through and through; their types only say more. */
export const asJson = (value: unknown) => value as JsonValue;

/**
 * A tool's input schema without what JSON Schema says anyway: `additionalProperties: true` is its
 * default, and the schema generator writes it on every object.
 */
export const leanSchema = <S>(schema: S): S => {
  if (Array.isArray(schema)) {
    return schema.map(leanSchema) as S;
  }
  if (typeof schema !== "object" || schema === null) {
    return schema;
  }
  return Object.fromEntries(
    Object.entries(schema).flatMap(([key, value]) =>
      key === "additionalProperties" && value === true
        ? []
        : [[key, leanSchema(value)]]
    )
  ) as S;
};
