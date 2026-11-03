import { Schema } from "effect";

/** Anything that stops a step: the message says what, in words that say what to do. */
export class LabError extends Schema.TaggedError<LabError>()("LabError", {
  message: Schema.String,
}) {}
