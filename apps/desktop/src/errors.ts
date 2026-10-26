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
