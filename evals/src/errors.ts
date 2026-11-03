import { Schema } from "effect";

/** Anything that stops a step: the message says what, in words that say what to do. */
export class EvalsError extends Schema.TaggedError<EvalsError>()("EvalsError", {
  message: Schema.String,
}) {}
