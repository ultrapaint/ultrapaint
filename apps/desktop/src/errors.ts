/** What can go wrong in the app's own process. Each says what happened in words for the user. */
import { Schema } from "effect";

/** The project's server did not come up: it exited, or said nothing in time. */
export class ServerStartError extends Schema.TaggedError<ServerStartError>()(
  "ServerStartError",
  { message: Schema.String }
) {}

/** The app's own files in its data directory could not be read or written. */
export class StoreError extends Schema.TaggedError<StoreError>()("StoreError", {
  message: Schema.String,
}) {}

/** A project the list does not have. */
export class UnknownProject extends Schema.TaggedError<UnknownProject>()(
  "UnknownProject",
  { id: Schema.String }
) {
  override get message() {
    return `no project ${this.id} in the list`;
  }
}

/** The page called a capability of the shell bridge with what its input does not take. */
export class BridgeInputError extends Schema.TaggedError<BridgeInputError>()(
  "BridgeInputError",
  { capability: Schema.String, message: Schema.String }
) {}

/** The page called a capability the open project does not show: this machine's, for a remote one. */
export class HiddenCapability extends Schema.TaggedError<HiddenCapability>()(
  "HiddenCapability",
  { capability: Schema.String }
) {
  override get message() {
    return `${this.capability} is not shown for a project on another machine`;
  }
}
