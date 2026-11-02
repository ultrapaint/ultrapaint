import { Schema } from "effect";

/** The request was well formed on the wire but cannot be carried out as asked. */
export class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", {
  message: Schema.String,
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  message: Schema.String,
}) {}

/** No target repository is configured yet. */
export class NotConfigured extends Schema.TaggedError<NotConfigured>()(
  "NotConfigured",
  { message: Schema.String }
) {}

/** A path resolved outside the repository, or outside the designs directory for an edit. */
export class ForbiddenPath extends Schema.TaggedError<ForbiddenPath>()(
  "ForbiddenPath",
  { message: Schema.String }
) {}

/** The file changed since the caller last saw it. */
export class Stale extends Schema.TaggedError<Stale>()("Stale", {
  message: Schema.String,
}) {}

export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", {
  message: Schema.String,
}) {}

/** The agent process or its ACP session failed. */
export class AgentFailure extends Schema.TaggedError<AgentFailure>()(
  "AgentFailure",
  { message: Schema.String }
) {}

/** A command the server ran on the repository (git) exited with an error. */
export class CommandFailed extends Schema.TaggedError<CommandFailed>()(
  "CommandFailed",
  { message: Schema.String }
) {}

type WireError =
  | BadRequest
  | NotFound
  | NotConfigured
  | ForbiddenPath
  | Stale
  | Conflict
  | AgentFailure
  | CommandFailed;

/** Stable, lower-case codes for clients that do not match on `_tag`. */
export const errorCodes = {
  AgentFailure: "agent_error",
  BadRequest: "bad_request",
  CommandFailed: "command_failed",
  Conflict: "conflict",
  ForbiddenPath: "forbidden_path",
  NotConfigured: "not_configured",
  NotFound: "not_found",
  Stale: "stale",
} as const satisfies Record<WireError["_tag"], string>;

export type ErrorCode = (typeof errorCodes)[WireError["_tag"]] | "internal";
