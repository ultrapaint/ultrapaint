/**
 * Where the app keeps what is the person's, outside its own data (ADR 0091): the person's folder,
 * `.ultrapaint` in their home folder unless they moved it, which every project's server is given
 * (`--user-dir`) and the app reads too (the chat's preferences); and the folder the start screen
 * makes new projects in, `~/Ultrapaint` unless they changed it. Both choices are the app's own
 * settings, `folders.json` in its data directory.
 */

import { UserFolderLocationJson } from "@ultrapaint/contracts/user-folder";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  Semaphore,
} from "effect";
import { writeAtomic } from "./atomic-write.ts";
import { FolderMovedOldKept, FolderMoveRefused, StoreError } from "./errors.ts";

/** The person's folder's name, wherever it is: the server's `STATE_DIR_NAME`. */
export const USER_DIR_NAME = ".ultrapaint";

/** Where new projects go unless the person picks another folder: `~/Ultrapaint`. */
export const DESIGNS_HOME = "Ultrapaint";

const FoldersFile = Schema.fromJsonString(
  Schema.Struct({
    /** The folder new projects are made in; absent, `~/Ultrapaint`. */
    newProjects: Schema.optional(Schema.String),
    /** The folder the person's folder is in; absent, the home folder. */
    userDirIn: Schema.optional(Schema.String),
    version: Schema.Literal(1),
  })
);
type FoldersFile = typeof FoldersFile.Type;
const decodeFile = Schema.decodeUnknownEffect(FoldersFile);
const encodeFile = Schema.encodeEffect(FoldersFile);

const FOLDERS_FILE = "folders.json";

const encodeLocation = Schema.encodeEffect(UserFolderLocationJson);

/** The folders as the app has them now, each absolute. */
export interface CurrentFolders {
  /** Where the start screen makes a new project. */
  readonly newProjects: string;
  /** The person's folder: `.ultrapaint` in `userDirIn`. */
  readonly user: string;
  /** The folder the person's folder is in: what the servers are given as `--user-dir`. */
  readonly userDirIn: string;
}

export class Folders extends Context.Service<
  Folders,
  {
    readonly current: Effect.Effect<CurrentFolders, StoreError>;
    /**
     * Why the person's folder cannot move into `parent`, before anything is stopped or copied:
     * `parent` inside the folder itself, or holding a `.ultrapaint` already. Nothing when it can.
     */
    readonly checkMove: (
      parent: string
    ) => Effect.Effect<void, FolderMoveRefused | StoreError>;
    /**
     * Moves the person's folder into `parent`: its contents copied across, the setting saved,
     * then the old folder removed, only once copied. A copy that fails leaves everything as it
     * was. Run with no server using the folder. Answers with where the folder is now.
     */
    readonly moveUser: (
      parent: string
    ) => Effect.Effect<
      string,
      FolderMoveRefused | FolderMovedOldKept | StoreError
    >;
    /** Makes new projects in `dir` from now on. */
    readonly setNewProjects: (dir: string) => Effect.Effect<void, StoreError>;
  }
>()("ultrapaint/desktop/Folders") {
  /**
   * `dataDir` is the app's data directory; `home`, the person's home folder; `location`, the file
   * every server reads a moved person's folder from (`userFolderLocationFile`), so an agent
   * outside the app finds it too.
   */
  static readonly layer = (options: {
    readonly dataDir: string;
    readonly home: string;
    readonly location?: string;
  }) =>
    Layer.effect(
      Folders,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const file = path.join(options.dataDir, FOLDERS_FILE);
        const lock = yield* Semaphore.make(1);
        const fail = (what: string) => (error: { message: string }) =>
          new StoreError({ message: `${what} ${file}: ${error.message}` });

        const read = Effect.gen(function* () {
          if (!(yield* fs.exists(file))) {
            return { version: 1 } as FoldersFile;
          }
          return yield* decodeFile(yield* fs.readFileString(file));
        }).pipe(Effect.mapError(fail("the folders couldn’t be read from")));

        const write = (next: FoldersFile) =>
          Effect.gen(function* () {
            const text = yield* encodeFile(next);
            yield* writeAtomic(file, `${text}\n`).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path)
            );
          }).pipe(Effect.mapError(fail("the folders couldn’t be written to")));

        /**
         * Where every server finds the person's folder once moved; none once it is back home.
         * Not written, an agent outside the app looks in the home folder: the move stands.
         */
        const recordLocation = (userDirIn: string | undefined) => {
          const { location } = options;
          if (location === undefined) {
            return Effect.void;
          }
          const done =
            userDirIn === undefined
              ? fs.remove(location, { force: true })
              : Effect.gen(function* () {
                  const text = yield* encodeLocation({ userDirIn, version: 1 });
                  yield* fs.makeDirectory(path.dirname(location), {
                    recursive: true,
                  });
                  yield* writeAtomic(location, `${text}\n`).pipe(
                    Effect.provideService(FileSystem.FileSystem, fs),
                    Effect.provideService(Path.Path, path)
                  );
                });
          return Effect.ignore(done, { log: true });
        };

        const current = Effect.map(read, (kept): CurrentFolders => {
          const userDirIn = kept.userDirIn ?? options.home;
          return {
            newProjects:
              kept.newProjects ?? path.join(options.home, DESIGNS_HOME),
            user: path.join(userDirIn, USER_DIR_NAME),
            userDirIn,
          };
        });

        /** A path as the file system has it, links followed; as given when it isn't there. */
        const real = (dir: string) =>
          fs.realPath(dir).pipe(Effect.orElseSucceed(() => path.resolve(dir)));

        const checkMove = Effect.fn("Folders.checkMove")(function* (
          parent: string
        ) {
          const { user } = yield* current;
          const from = yield* real(user);
          const into = yield* real(parent);
          if (into === from || into.startsWith(`${from}${path.sep}`)) {
            return yield* new FolderMoveRefused({
              message: `That folder is inside your folder. Choose one outside ${user}.`,
            });
          }
          if (into === path.dirname(from)) {
            return yield* new FolderMoveRefused({
              message: `Your folder is in ${parent} already. Choose another folder.`,
            });
          }
          const to = path.join(parent, USER_DIR_NAME);
          if (yield* fs.exists(to).pipe(Effect.orElseSucceed(() => true))) {
            return yield* new FolderMoveRefused({
              message: `${parent} already has a ${USER_DIR_NAME} folder. Choose another folder, or move that one away first.`,
            });
          }
        });

        const moveUser = Effect.fn("Folders.moveUser")(function* (
          parent: string
        ) {
          yield* checkMove(parent);
          const kept = yield* read;
          const { user } = yield* current;
          const to = path.join(parent, USER_DIR_NAME);
          // A folder never made (no project has run yet) has nothing to copy.
          const there = yield* fs
            .exists(user)
            .pipe(Effect.orElseSucceed(() => false));
          if (there) {
            yield* fs.copy(user, to, { preserveTimestamps: true }).pipe(
              Effect.catch((error) =>
                Effect.andThen(
                  // What was copied goes: the folder stays where it was, whole.
                  Effect.ignore(
                    fs.remove(to, { force: true, recursive: true })
                  ),
                  Effect.fail(
                    new FolderMoveRefused({
                      message: `Couldn’t copy your folder to ${parent} (${error.message}). It’s still in ${path.dirname(user)}.`,
                    })
                  )
                )
              )
            );
          }
          // Back in the home folder, it is the default again.
          const home = path.resolve(parent) === path.resolve(options.home);
          yield* write({ ...kept, userDirIn: home ? undefined : parent });
          yield* recordLocation(home ? undefined : path.resolve(parent));
          if (there) {
            yield* fs.remove(user, { recursive: true }).pipe(
              Effect.mapError(
                (error) =>
                  new FolderMovedOldKept({
                    message: `Your folder is now in ${parent}, but the old one couldn’t be removed (${error.message}). Delete ${user} yourself.`,
                    user: to,
                  })
              )
            );
          }
          return to;
        }, lock.withPermits(1));

        const setNewProjects = Effect.fn("Folders.setNewProjects")(function* (
          dir: string
        ) {
          yield* write({
            ...(yield* read),
            newProjects:
              path.resolve(dir) ===
              path.resolve(path.join(options.home, DESIGNS_HOME))
                ? undefined
                : dir,
          });
        }, lock.withPermits(1));

        return Folders.of({ checkMove, current, moveUser, setNewProjects });
      })
    );
}
