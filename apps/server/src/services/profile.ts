import { BadRequest } from "@ultrapaint/contracts/errors";
import { UserProfile } from "@ultrapaint/contracts/settings";
import { Context, Effect, FileSystem, Layer, Path, Ref, Schema } from "effect";
import { AppLog } from "../app-log.ts";
import { makeWriteAtomic } from "../atomic-write.ts";
import { ServerConfig } from "../config.ts";
import { makeExists } from "../fs-exists.ts";

const ProfileJson = Schema.fromJsonString(UserProfile);
const decodeProfile = Schema.decodeUnknownEffect(ProfileJson);
const encodeProfile = Schema.encodeEffect(ProfileJson);

/** File in the user's directory (`~/.ultrapaint`) the profile is kept in. */
const PROFILE_FILE = "profile.json";

/**
 * Who the user is to the tool: a display name for comments and the avatar when git gives none.
 * It is the user's, not a project's, so it lives in the user's directory and follows them from
 * one project to the next, and never lands in a configuration a team shares.
 */
export class ProfileService extends Context.Service<
  ProfileService,
  {
    readonly get: Effect.Effect<UserProfile>;
    readonly set: (
      profile: UserProfile
    ) => Effect.Effect<UserProfile, BadRequest>;
  }
>()("ultrapaint/server/ProfileService") {
  static readonly layer = Layer.effect(
    ProfileService,
    Effect.gen(function* () {
      const { userDir } = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const log = yield* AppLog;
      const writeAtomic = makeWriteAtomic(fs, path);
      const exists = makeExists(fs);
      const file = path.join(userDir, PROFILE_FILE);

      const read = Effect.gen(function* () {
        if (!(yield* exists(file))) {
          return {};
        }
        return yield* decodeProfile(yield* fs.readFileString(file));
      }).pipe(
        // A profile that cannot be read costs the name, not the editor.
        Effect.catch((error) =>
          Effect.as(
            log.log("server", "warn", `ignoring ${file}: ${error.message}`),
            {}
          )
        )
      );
      const current = yield* Ref.make<UserProfile>(yield* read);

      const set = Effect.fn("ProfileService.set")(function* (
        profile: UserProfile
      ) {
        const name = profile.displayName?.trim();
        const next: UserProfile = name ? { displayName: name } : {};
        const text = yield* encodeProfile(next).pipe(Effect.orDie);
        yield* writeAtomic(file, `${text}\n`).pipe(
          Effect.mapError(
            (error) =>
              new BadRequest({
                message: `The profile could not be saved to ${file}: ${error.message}`,
              })
          )
        );
        yield* Ref.set(current, next);
        return next;
      });

      return ProfileService.of({ get: Ref.get(current), set });
    })
  );
}
