/**
 * The app's updates (ADR 0078): GitHub is asked at start and every hour for the releases since
 * the one running, and the newest is made ready to install, so the window shows it (`update`)
 * once there is something to do about it.
 *
 * - **Swap**, the macOS app: unsigned, Squirrel does not update it, so the app does. It downloads
 *   the release's zip, checks it against the checksum its feed gives, unpacks it beside its data,
 *   and on a restart a script waits for the app to exit, puts the new bundle where the running
 *   one is (wherever it was installed, under whatever name) and opens it.
 * - **Feed**, an AppImage: electron-updater downloads it and says so (`downloaded`); the restart
 *   is its own.
 * - **Download**, a deb: the release's page, to download by hand.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { AppRelease, AppUpdate } from "@ultrapaint/contracts/shell-bridge";
import { Context, Effect, Layer, Schedule, Semaphore } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { UpdateCheckError } from "./errors.ts";
import {
  type MacZip,
  macZip,
  releasePage,
  releasesSince,
  swapTarget,
} from "./updates.ts";

/** How this copy of the app is updated. */
export type InstallMode =
  /** The macOS app, which replaces its own bundle; staged under `stageDir`. */
  | {
      readonly _tag: "Swap";
      readonly executable: string;
      readonly stageDir: string;
    }
  /** An AppImage: electron-updater downloads it when `check` asks, and says so (`downloaded`). */
  | { readonly _tag: "Feed"; readonly check: Effect.Effect<void> }
  /** Installed by hand from the release's page: a deb. */
  | { readonly _tag: "Download" }
  /** Not packaged (development): nothing is checked. */
  | { readonly _tag: "None" };

export interface UpdaterOptions {
  /** The version running. */
  readonly current: string;
  readonly fetch: typeof fetch;
  readonly mode: InstallMode;
  /** Tells the window what there is to do (`update`); null when nothing. */
  readonly publish: (update: AppUpdate | null) => void;
}

/** A release unpacked and ready to take the running app's place. */
interface Staged {
  readonly app: string;
  readonly target: string;
  readonly version: string;
}

/** Written beside an unpacked release once all of it is there. */
const READY_FILE = ".ready";
const APP_RE = /\.app$/;

/**
 * Waits for the app (`$1`) to exit, puts the staged bundle (`$3`) where it ran from (`$2`), the
 * old one kept until the new one is in place and put back if it cannot be, and opens it. Gives up
 * after ten minutes: the app did not quit.
 */
const SWAP_SCRIPT = `
pid="$1"; target="$2"; staged="$3"; waited=0
while kill -0 "$pid" 2>/dev/null; do
  sleep 0.2; waited=$((waited + 1))
  [ "$waited" -gt 3000 ] && exit 1
done
old="$target.old-$$"
mv "$target" "$old" || exit 1
if mv "$staged" "$target"; then rm -rf "$old"; else mv "$old" "$target"; fi
xattr -dr com.apple.quarantine "$target" 2>/dev/null
open "$target"
`;

/** Downloads `zip` to `file`, checking its size and its SHA-512 as the feed gives them. */
const download = Effect.fn("Updater.download")(function* (
  fetchFn: typeof fetch,
  zip: MacZip,
  file: string
) {
  const response = yield* Effect.tryPromise({
    catch: (error) =>
      new UpdateCheckError({ message: `${zip.url}: ${String(error)}` }),
    try: (signal) => fetchFn(zip.url, { signal }),
  }).pipe(
    Effect.filterOrFail(
      (r): r is Response & { body: ReadableStream<Uint8Array> } =>
        r.ok && r.body !== null,
      (r) =>
        new UpdateCheckError({ message: `${zip.url} answered ${r.status}` })
    )
  );
  const hash = createHash("sha512");
  let size = 0;
  yield* Effect.tryPromise({
    catch: (error) =>
      new UpdateCheckError({ message: `${zip.url}: ${String(error)}` }),
    try: () =>
      pipeline(
        Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
        new Transform({
          transform(chunk: Buffer, _encoding, done) {
            hash.update(chunk);
            size += chunk.length;
            done(null, chunk);
          },
        }),
        createWriteStream(file)
      ),
  });
  const sha512 = hash.digest("base64");
  if (size !== zip.size || sha512 !== zip.sha512) {
    return yield* new UpdateCheckError({
      message: "the download doesn’t match the release’s checksum",
    });
  }
});

const fsEffect = <A>(what: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (error) =>
      new UpdateCheckError({ message: `${what}: ${String(error)}` }),
    try: run,
  });

export class Updater extends Context.Service<
  Updater,
  {
    /** Asks GitHub now, and makes the newest release ready to install. */
    readonly check: Effect.Effect<void>;
    /** electron-updater has `version` downloaded (Feed): it is installed on a restart. */
    readonly downloaded: (version: string) => Effect.Effect<void>;
    /**
     * Starts what puts the staged release in place once the app exits (Swap); false when there
     * is none, and the app only quits.
     */
    readonly install: Effect.Effect<boolean>;
  }
>()("ultrapaint/desktop/Updater") {
  static readonly layer = (options: UpdaterOptions) =>
    Layer.effect(
      Updater,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const { current, fetch: fetchFn, mode, publish } = options;
        // One check at a time: the hourly one and a page's wait for the same download.
        const checking = yield* Semaphore.make(1);
        let staged: Staged | null = null;
        let releases: readonly AppRelease[] = [];
        let fed: string | null = null;

        const tell = (
          install: AppUpdate["install"],
          reason?: string
        ): Effect.Effect<void> =>
          Effect.sync(() => {
            const [newest, ...rest] = releases;
            publish(
              newest
                ? {
                    current,
                    install,
                    ...(reason ? { reason } : {}),
                    releases: [newest, ...rest],
                    url: releasePage(newest.version),
                  }
                : null
            );
          });

        /** The newest release unpacked in `stageDir`, downloaded first when it is not there yet. */
        const stage = Effect.fn("Updater.stage")(function* (
          stageDir: string,
          version: string,
          target: string
        ) {
          const dir = path.join(stageDir, version);
          const found = yield* Effect.promise(() =>
            readdir(dir)
              // Not there yet: downloaded now.
              .catch((): string[] => [])
          );
          const ready = found.includes(READY_FILE)
            ? found.find((name) => APP_RE.test(name))
            : undefined;
          if (ready) {
            return { app: path.join(dir, ready), target, version };
          }
          // Whatever an earlier release or an unfinished download left goes.
          yield* fsEffect("the update folder", () =>
            rm(stageDir, { force: true, recursive: true }).then(() =>
              mkdir(dir, { recursive: true })
            )
          );
          const zip = yield* macZip(fetchFn, version);
          const file = path.join(stageDir, `${version}.zip`);
          yield* download(fetchFn, zip, file);
          // `ditto` keeps what a zip of an app bundle holds: its links, modes and signature.
          yield* spawner
            .string(
              ChildProcess.make("ditto", ["-x", "-k", file, dir], {
                stdin: "ignore",
              })
            )
            .pipe(
              Effect.mapError(
                (error) =>
                  new UpdateCheckError({
                    message: `the update could not be unpacked: ${String(error)}`,
                  })
              )
            );
          const names = yield* fsEffect("the update folder", () =>
            readdir(dir)
          );
          const app = names.find((name) => APP_RE.test(name));
          if (!app) {
            return yield* new UpdateCheckError({
              message: "the update holds no app",
            });
          }
          yield* fsEffect("the update folder", () =>
            Promise.all([
              writeFile(path.join(dir, READY_FILE), ""),
              rm(file, { force: true }),
            ])
          );
          return { app: path.join(dir, app), target, version };
        });

        const run = Effect.gen(function* () {
          releases = yield* releasesSince(fetchFn, current);
          const [newest] = releases;
          if (!newest) {
            staged = null;
            return yield* tell("restart");
          }
          switch (mode._tag) {
            case "None":
              return;
            case "Download":
              return yield* tell("download");
            case "Feed":
              // electron-updater downloads it, and says so: until then there is nothing to do.
              yield* mode.check;
              return fed === newest.version
                ? yield* tell("restart")
                : undefined;
            case "Swap": {
              const target = yield* swapTarget(mode.executable);
              if (target._tag === "Cannot") {
                return yield* tell("download", target.reason);
              }
              staged = yield* stage(
                mode.stageDir,
                newest.version,
                target.path
              ).pipe(
                Effect.tapError((error) =>
                  tell(
                    "download",
                    `The update couldn’t be downloaded: ${error.message}. It’s tried again within the hour.`
                  )
                )
              );
              return yield* tell("restart");
            }
            default:
              return;
          }
        });

        // Offline, rate-limited or a download cut short: tried again at the next check.
        const check = checking.withPermits(1)(
          Effect.ignore(
            run.pipe(
              Effect.tapError((error) =>
                Effect.logWarning(`[desktop] update check: ${error.message}`)
              )
            )
          )
        );

        if (mode._tag !== "None") {
          yield* check.pipe(
            Effect.repeat(Schedule.spaced("1 hour")),
            Effect.forkScoped
          );
        }

        return Updater.of({
          check,
          downloaded: (version) =>
            Effect.suspend(() => {
              fed = version;
              return releases[0]?.version === version ? tell("restart") : check;
            }),
          install: Effect.sync(() => {
            if (!staged || mode._tag !== "Swap") {
              return false;
            }
            // Outlives the app on purpose: it waits for it to exit, then replaces it.
            spawn(
              "/bin/sh",
              [
                "-c",
                SWAP_SCRIPT,
                "swap",
                String(process.pid),
                staged.target,
                staged.app,
              ],
              { detached: true, stdio: "ignore" }
            ).unref();
            return true;
          }),
        });
      })
    );
}

/** No update is ever found: for tests of the app that are not about updates. */
export const noUpdates = Layer.succeed(
  Updater,
  Updater.of({
    check: Effect.void,
    downloaded: () => Effect.void,
    install: Effect.succeed(false),
  })
);
