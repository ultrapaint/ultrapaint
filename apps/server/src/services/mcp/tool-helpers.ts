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
 * How a tool takes a page: its URL, or its file when it has none. Every tool repeats it, and an
 * agent reads every tool's schema, so it is kept short; the briefing says the rest.
 */
export const PAGE_PARAMETER =
  "URL (/settings/billing) or file (drafts/billing.page.json) of the page";

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
