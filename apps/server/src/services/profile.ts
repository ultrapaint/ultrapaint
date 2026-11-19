import { BadRequest } from "@ultrapaint/contracts/errors";
import { UserProfile } from "@ultrapaint/contracts/settings";
import {
  Clock,
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

const ProfileJson = Schema.fromJsonString(UserProfile);
const decodeProfile = Schema.decodeUnknownEffect(ProfileJson);
const encodeProfile = Schema.encodeEffect(ProfileJson);

/** How many names an unreadable profile is tried under before the save gives up. */
const ASIDE_TRIES = 100;

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
      const file = path.join(userDir, PROFILE_FILE);

      // None only when the file is known not to be there: one that can't be looked at fails.
      const readFile = Effect.gen(function* () {
        if (!(yield* fs.exists(file))) {
          return {};
        }
        return yield* decodeProfile(yield* fs.readFileString(file));
      });
      /** The file as it is, or `fallback` when it cannot be read, which is logged. */
      const readOr = (fallback: Effect.Effect<UserProfile>) =>
        readFile.pipe(
          Effect.catch((error) =>
            Effect.andThen(
              log.log("server", "warn", `ignoring ${file}: ${error.message}`),
              fallback
            )
          )
        );
      // A profile that cannot be read as the server starts costs the name, not the editor.
      const current = yield* Ref.make<UserProfile>(
        yield* readOr(Effect.succeed({}))
      );
      const changes = yield* PubSub.unbounded<UserProfile>();
      /** One save at a time in this server. */
      const saving = yield* Semaphore.make(1);

      /**
       * The profile as its file has it now: another project's server, the desktop app's other
       * windows, may have saved it since this one read it (ADR 0106).
       */
      /**
       * `file` kept under a name of its own, `<file>.unreadable-<time>`, then `-1`, `-2`… when
       * that is taken: a hard link, which fails rather than replace what is there, then the file
       * removed. Fails, the file left as it is, when it can't be kept.
       */
      const keptAside = Effect.fnUntraced(function* (from: string) {
        const at = yield* Clock.currentTimeMillis;
        for (let n = 0; n < ASIDE_TRIES; n += 1) {
          const aside = `${from}.unreadable-${at}${n === 0 ? "" : `-${n}`}`;
          const linked = yield* fs.link(from, aside).pipe(
            Effect.as(true),
            Effect.catchReason("PlatformError", "AlreadyExists", () =>
              Effect.succeed(false)
            )
          );
          if (linked) {
            yield* fs.remove(from);
            return aside;
          }
        }
        return yield* new BadRequest({
          message: `no free name beside ${from} after ${ASIDE_TRIES} tries`,
        });
      });

      /** The profile as its file has it now, or as this server last had it. */
      const fresh = Effect.tap(readOr(Ref.get(current)), (profile) =>
        Ref.set(current, profile)
      );

      /**
       * What a save is merged into: the file as it is now. One that can't be read is moved aside
       * (`profile.json.unreadable-<time>`), never written over, and the save is refused when it
       * can't be; and the save goes on from what this
       * server last had: nothing the file held is lost, and saving still works (ADR 0106).
       */
      const toSaveOn = readFile.pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const aside = yield* keptAside(file).pipe(
              Effect.mapError(
                (moved) =>
                  new BadRequest({
                    message: `${file} can't be read (${error.message}) or kept aside (${moved.message}): the profile was not saved.`,
                  })
              )
            );
            yield* log.log(
              "server",
              "warn",
              `${file} could not be read (${error.message}): kept as ${aside}`
            );
            return yield* Ref.get(current);
          })
        ),
        Effect.tap((profile) => Ref.set(current, profile))
      );

      const set = Effect.fn("ProfileService.set")(function* (
        profile: UserProfile
      ) {
        // A field the request leaves out keeps its value: the name is set apart from the rest,
        // and each preference apart from the others; merged into the file as it is now, so a
        // save from another server since is kept.
        const kept: UserProfile = yield* toSaveOn;
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
