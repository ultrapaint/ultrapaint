import { Schema } from "effect";

/** The agent executable could not be started. */
export class AcpSpawnError extends Schema.TaggedError<AcpSpawnError>()(
  "AcpSpawnError",
  { command: Schema.String, message: Schema.String }
) {}

/** The agent process ended while a call was in flight or before one was made. */
export class AcpProcessExited extends Schema.TaggedError<AcpProcessExited>()(
  "AcpProcessExited",
  {
    code: Schema.NullOr(Schema.Number),
    message: Schema.String,
    signal: Schema.NullOr(Schema.String),
  }
) {}

/**
 * The agent answered a call with a JSON-RPC error. `message` is the agent's own explanation
 * when it sent one in `data`, which is more useful than the generic "Internal error".
 */
export class AcpRequestError extends Schema.TaggedError<AcpRequestError>()(
  "AcpRequestError",
  {
    code: Schema.NullOr(Schema.Number),
    message: Schema.String,
    method: Schema.String,
  }
) {}

export type AcpError = AcpSpawnError | AcpProcessExited | AcpRequestError;

/** Terminal the agent referred to does not exist, or its command could not be started. */
export class TerminalError extends Schema.TaggedError<TerminalError>()(
  "TerminalError",
  { message: Schema.String }
) {}
