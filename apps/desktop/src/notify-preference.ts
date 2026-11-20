/**
 * The person's Notifications preference (Settings › General), as the main process reads it to tell
 * them of another project's agent while the window is behind (ADR 0107). The editor keeps it in the
 * person's profile, `profile.json` in their folder (ADR 0093), under its Appearance preferences;
 * the app reads it there at the moment it notifies, so a change made in any project's editor holds
 * at once.
 */
import { Effect, FileSystem, Path, Schema } from "effect";

/** What the person chose: nothing, a notification, a sound, or both. */
export const NotifyPreference = Schema.Literals([
  "off",
  "notification",
  "sound",
  "both",
]);
export type NotifyPreference = typeof NotifyPreference.Type;

/** The server's `PROFILE_FILE`, in the person's folder. */
const PROFILE_FILE = "profile.json";

/** The part of the profile the preference is in, by the editor's names (`person-preferences.ts`). */
const Profile = Schema.fromJsonString(
  Schema.Struct({
    preferences: Schema.optional(
      Schema.Struct({
        appearance: Schema.optional(
          Schema.Struct({ notifications: Schema.optional(NotifyPreference) })
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
export const notifyPreference = Effect.fnUntraced(function* (user: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fs.readFileString(path.join(user, PROFILE_FILE)).pipe(
    Effect.flatMap(decodeProfile),
    Effect.map(
      (profile): NotifyPreference =>
        profile.preferences?.appearance?.notifications ?? "off"
    ),
    // Unreadable, it is as if the person had chosen nothing yet.
    Effect.orElseSucceed((): NotifyPreference => "off")
  );
});
