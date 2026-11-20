/**
 * The person's Notifications preference (Settings › General), as the main process reads it to tell
 * them of another project's agent while the window is behind (ADR 0107), until an editor has told
 * it the preference it holds (`notifications.prefer`). The editor keeps it in the person's profile
 * (ADR 0093), under its Appearance preferences.
 */
import { Notifications, PROFILE_FILE } from "@ultrapaint/contracts/settings";
import { Effect, FileSystem, Path, Schema } from "effect";

/** The part of the profile the preference is in, by the editor's names (`person-preferences.ts`). */
const Profile = Schema.fromJsonString(
  Schema.Struct({
    preferences: Schema.optional(
      Schema.Struct({
        appearance: Schema.optional(
          Schema.Struct({ notifications: Schema.optional(Notifications) })
        ),
      })
    ),
  })
);
const decodeProfile = Schema.decodeUnknownEffect(Profile);

/**
 * The preference kept in the person's folder `user`: Off, the editor's default, when the profile
 * is not there, cannot be read, or holds no value it knows.
 */
export const notifyPreference = Effect.fn("notifyPreference")(function* (
  user: string
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fs.readFileString(path.join(user, PROFILE_FILE)).pipe(
    Effect.flatMap(decodeProfile),
    Effect.map(
      (profile): Notifications =>
        profile.preferences?.appearance?.notifications ?? "off"
    ),
    // Unreadable, it is as if the person had chosen nothing yet.
    Effect.orElseSucceed((): Notifications => "off")
  );
});
