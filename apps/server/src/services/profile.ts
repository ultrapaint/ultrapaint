import { BadRequest } from "@ultrapaint/contracts/errors";
import { UserProfile } from "@ultrapaint/contracts/settings";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  PubSub,
  Ref,
  Schema,
  Semaphore,
  Stream,
} from "effect";
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
    /** The profile each time it is set. */
    readonly changes: Stream.Stream<UserProfile>;
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
      const changes = yield* PubSub.unbounded<UserProfile>();
      /** One save at a time in this server. */
      const saving = yield* Semaphore.make(1);

      /**
       * The profile as its file has it now: another project's server, the desktop app's other
       * windows, may have saved it since this one read it (ADR 0106).
       */
      const fresh = Effect.tap(read, (profile) => Ref.set(current, profile));

      const set = Effect.fn("ProfileService.set")(function* (
        profile: UserProfile
      ) {
        // A field the request leaves out keeps its value: the name is set apart from the rest,
        // and each preference apart from the others; merged into the file as it is now, so a
        // save from another server since is kept.
        const kept: UserProfile = yield* fresh;
        const merged = { ...kept, ...profile };
        const name = merged.displayName?.trim();
        const preferences = { ...kept.preferences, ...profile.preferences };
        const next: UserProfile = {
          ...(name ? { displayName: name } : {}),
          ...(merged.keepFindings === true && { keepFindings: true }),
          ...(Object.keys(preferences).length > 0 && { preferences }),
        };
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
        yield* PubSub.publish(changes, next);
        return next;
      }, saving.withPermits(1));

      return ProfileService.of({
        changes: Stream.fromPubSub(changes),
        get: fresh,
        set,
      });
    })
  );
}
