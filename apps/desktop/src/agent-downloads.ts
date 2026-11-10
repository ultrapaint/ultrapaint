/**
 * An agent the user does not have, downloaded when they ask for it (PLAN-desktop D8): the pinned
 * release for this machine (`agent-releases.ts`), checked by its size and SHA-256 before anything
 * of it is kept, into the app's data directory and nowhere else. Never the user's own `claude`
 * or `codex`, nor where those keep their settings: what is downloaded here is the app's, and is
 * used only where no agent is installed. The app pins the release it was built with: once a newer
 * app pins another, the one downloaded before counts as not installed, and downloading again
 * puts the pinned one in its place.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createZstdDecompress } from "node:zlib";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { ChildProcessSpawner } from "effect/process";
import type { AgentRelease, CodexRelease } from "./agent-releases.ts";
import { runCommand } from "./command.ts";
import { isExecutable } from "./which.ts";

/** How a download is going, for the settings to show. */
interface DownloadProgress {
  /** Why it failed, when it did. */
  readonly message?: string;
  readonly phase: "downloading" | "verifying" | "unpacking" | "failed";
  readonly received: number;
  readonly total: number;
}

export class DownloadError extends Schema.TaggedError<DownloadError>()(
  "DownloadError",
  { message: Schema.String }
) {}

/** What was installed, beside it: the release, and the executable inside. */
const Installed = Schema.fromJsonString(
  Schema.Struct({
    executable: Schema.String,
    sha256: Schema.String,
    version: Schema.String,
  })
);
const decodeInstalled = Schema.decodeUnknownEffect(Installed);
const encodeInstalled = Schema.encodeEffect(Installed);

const CodexPackage = Schema.fromJsonString(
  Schema.Struct({
    entrypoint: Schema.String,
    target: Schema.String,
    version: Schema.String,
  })
);
const decodeCodexPackage = Schema.decodeUnknownEffect(CodexPackage);

const INSTALLED_FILE = "installed.json";

const TRAILING_SLASH_RE = /\/$/;

/**
 * Whether every entry of an archive unpacks inside the directory it is unpacked in, as a plain
 * file or directory: `names` from `tar -tzf`, `long` from `tar -tvzf`.
 */
export const safeArchive = (
  names: readonly string[],
  long: readonly string[]
) =>
  names.length > 0 &&
  names.length < 10_000 &&
  names.length === long.length &&
  long.every((line) => line.startsWith("-") || line.startsWith("d")) &&
  names.every((name) => {
    const parts = name.replace(TRAILING_SLASH_RE, "").split("/");
    return (
      name.length > 0 &&
      !name.startsWith("/") &&
      !name.includes("\\") &&
      parts.every((part) => part !== "" && part !== "." && part !== "..")
    );
  });

export class AgentDownloads extends Context.Service<
  AgentDownloads,
  {
    /** Downloads and installs the agent's release; the executable installed. */
    readonly download: (id: string) => Effect.Effect<string, DownloadError>;
    /**
     * The executable of the agent downloaded before, if it is the release pinned now and still
     * runs.
     */
    readonly installed: (id: string) => Effect.Effect<Option.Option<string>>;
    /** What can be downloaded of the agent on this machine. */
    readonly offer: (id: string) => Option.Option<AgentRelease>;
    /** How its download is going, or how it failed; nothing when none was started. */
    readonly progress: (
      id: string
    ) => Effect.Effect<Option.Option<DownloadProgress>>;
  }
>()("ultrapaint/desktop/AgentDownloads") {
  /** Agents downloaded into `dir`, of the `releases` for this machine. */
  static readonly layer = (
    dir: string,
    releases: Readonly<Record<string, AgentRelease | undefined>>
  ) =>
    Layer.effect(
      AgentDownloads,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const progress = yield* Ref.make<Record<string, DownloadProgress>>({});
        const locks = new Map<string, Semaphore.Semaphore>();
        const lockOf = (id: string) =>
          Effect.sync(() => {
            const found = locks.get(id);
            if (found) {
              return found;
            }
            const made = Semaphore.makeUnsafe(1);
            locks.set(id, made);
            return made;
          });

        const report = (id: string, next: DownloadProgress) =>
          Ref.update(progress, (all) => ({ ...all, [id]: next }));
        const fail = (message: string) => new DownloadError({ message });

        const installed = Effect.fn("AgentDownloads.installed")(function* (
          id: string
        ) {
          const record = yield* fs
            .readFileString(path.join(dir, id, INSTALLED_FILE))
            .pipe(Effect.flatMap(decodeInstalled), Effect.option);
          if (Option.isNone(record)) {
            return Option.none<string>();
          }
          // Another version than the one pinned, which the adapter bundled now was built
          // against: missing, until the pinned one is downloaded. With no release for this
          // machine there is none to download, and what is there stays.
          const pinned = releases[id]?.version;
          if (pinned !== undefined && record.value.version !== pinned) {
            return Option.none<string>();
          }
          const executable = path.join(dir, id, record.value.executable);
          return (yield* isExecutable(executable))
            ? Option.some(executable)
            : Option.none<string>();
        });

        /** Fetches `url` into `file`, counting and hashing as it comes. */
        const fetchTo = Effect.fnUntraced(function* (
          id: string,
          url: string,
          file: string,
          size: number
        ) {
          const response = yield* Effect.tryPromise({
            catch: (error) =>
              fail(`${url} could not be reached: ${String(error)}`),
            try: (signal) => fetch(url, { redirect: "follow", signal }),
          });
          const { body } = response;
          if (!(response.ok && body)) {
            return yield* fail(`${url} answered ${response.status}`);
          }
          const hash = createHash("sha256");
          let received = 0;
          yield* Stream.fromReadableStream({
            evaluate: () => body,
            onError: (error) =>
              fail(`the download broke off: ${String(error)}`),
          }).pipe(
            Stream.tap((chunk: Uint8Array) =>
              Effect.gen(function* () {
                received += chunk.byteLength;
                if (received > size) {
                  return yield* fail(
                    "the download is larger than the release it should be"
                  );
                }
                hash.update(chunk);
                yield* report(id, {
                  phase: "downloading",
                  received,
                  total: size,
                });
              })
            ),
            Stream.run(fs.sink(file, { flag: "wx", mode: 0o600 })),
            Effect.mapError((error) =>
              error._tag === "DownloadError"
                ? error
                : fail(`the download could not be written: ${error.message}`)
            )
          );
          return { received, sha256: hash.digest("hex") };
        });

        /** Decompresses a zstd file, hashing what comes out. */
        const unzstd = (from: string, to: string) =>
          Effect.tryPromise({
            catch: (error) =>
              fail(`the download could not be unpacked: ${String(error)}`),
            try: async () => {
              const hash = createHash("sha256");
              let size = 0;
              await pipeline(
                createReadStream(from),
                createZstdDecompress(),
                new Transform({
                  transform(chunk: Buffer, _encoding, done) {
                    hash.update(chunk);
                    size += chunk.length;
                    done(null, chunk);
                  },
                }),
                createWriteStream(to, { flags: "wx", mode: 0o755 })
              );
              return { sha256: hash.digest("hex"), size };
            },
          });

        const tar = (args: readonly string[]) =>
          runCommand("tar", args, { timeout: "5 minutes" }).pipe(
            Effect.provideService(
              ChildProcessSpawner.ChildProcessSpawner,
              spawner
            ),
            Effect.mapError((error) =>
              fail(`tar could not run: ${error.message}`)
            ),
            Effect.flatMap((result) =>
              result.exitCode === 0
                ? Effect.succeed(result.stdout)
                : Effect.fail(fail(`tar failed: ${result.stderr.trim()}`))
            )
          );

        /** Unpacks a Codex package and checks it is the release it should be. */
        const unpackCodex = Effect.fnUntraced(function* (
          release: CodexRelease,
          archive: string,
          into: string
        ) {
          const lines = (text: string) =>
            text.split("\n").filter((l) => l.length > 0);
          const names = lines(yield* tar(["-tzf", archive]));
          const long = lines(yield* tar(["-tvzf", archive]));
          if (!safeArchive(names, long)) {
            return yield* fail(
              "the package holds entries that would unpack outside it"
            );
          }
          yield* fs.makeDirectory(into, { recursive: true });
          yield* tar(["-xzf", archive, "-C", into]);
          const manifest = yield* fs
            .readFileString(path.join(into, "codex-package.json"))
            .pipe(
              Effect.flatMap(decodeCodexPackage),
              Effect.mapError(() =>
                fail("the package has no codex-package.json that reads")
              )
            );
          if (
            manifest.version !== release.version ||
            manifest.target !== release.target ||
            manifest.entrypoint !== release.entrypoint
          ) {
            return yield* fail("the package is not the release it should be");
          }
          return release.entrypoint;
        });

        /** Unpacks the checked download into `into`: the executable's path inside it. */
        const unpack = Effect.fnUntraced(function* (
          release: AgentRelease,
          archive: string,
          into: string
        ) {
          if (release.kind === "tar-gz-package") {
            return yield* unpackCodex(release, archive, into);
          }
          yield* fs.makeDirectory(into);
          const out = yield* unzstd(archive, path.join(into, "claude"));
          if (out.size !== release.size || out.sha256 !== release.sha256) {
            return yield* fail(
              "the unpacked agent is not the release it should be: its size or SHA-256 differs. Nothing was installed."
            );
          }
          return "claude";
        });

        const install = Effect.fnUntraced(function* (
          id: string,
          release: AgentRelease
        ) {
          const agentDir = path.join(dir, id);
          yield* fs.makeDirectory(agentDir, { recursive: true });
          // Next to where it goes, so that it is moved there in one rename; gone with the scope.
          const staging = yield* fs.makeTempDirectoryScoped({
            directory: agentDir,
            prefix: ".download-",
          });
          const download = path.join(staging, "download");
          const unpacked = path.join(staging, release.version);
          const expected =
            release.kind === "zst-binary" ? release.zstSize : release.size;
          const fetched = yield* fetchTo(id, release.url, download, expected);
          yield* report(id, {
            phase: "verifying",
            received: fetched.received,
            total: expected,
          });
          const sha256 =
            release.kind === "zst-binary" ? release.zstSha256 : release.sha256;
          if (fetched.received !== expected || fetched.sha256 !== sha256) {
            return yield* fail(
              "the download is not the release it should be: its size or SHA-256 differs. Nothing was installed."
            );
          }
          yield* report(id, {
            phase: "unpacking",
            received: expected,
            total: expected,
          });
          const executable = yield* unpack(release, download, unpacked);
          if (!(yield* isExecutable(path.join(unpacked, executable)))) {
            return yield* fail("the unpacked agent is not a program that runs");
          }
          const final = path.join(agentDir, release.version);
          yield* Effect.ignore(fs.remove(final, { recursive: true }));
          yield* fs.rename(unpacked, final);
          const record = yield* encodeInstalled({
            executable: path.join(release.version, executable),
            sha256: release.sha256,
            version: release.version,
          });
          yield* fs.writeFileString(
            path.join(agentDir, INSTALLED_FILE),
            `${record}\n`
          );
          // What an earlier version left: the record names this one alone.
          const kept = new Set([
            release.version,
            INSTALLED_FILE,
            path.basename(staging),
          ]);
          for (const entry of yield* fs.readDirectory(agentDir)) {
            if (!kept.has(entry)) {
              yield* Effect.ignore(
                fs.remove(path.join(agentDir, entry), { recursive: true })
              );
            }
          }
          return path.join(final, executable);
        }, Effect.scoped);

        const download = Effect.fn("AgentDownloads.download")(function* (
          id: string
        ) {
          const release = releases[id];
          if (!release) {
            return yield* fail(
              "there is no release of this agent for this computer"
            );
          }
          const lock = yield* lockOf(id);
          return yield* lock.withPermits(1)(
            Effect.gen(function* () {
              // Asked twice: the second finds what the first installed. A version the app no
              // longer pins is not found, and is replaced.
              const done = yield* installed(id);
              if (Option.isSome(done)) {
                return done.value;
              }
              yield* report(id, {
                phase: "downloading",
                received: 0,
                total: 0,
              });
              return yield* install(id, release).pipe(
                Effect.mapError((error) =>
                  error._tag === "DownloadError"
                    ? error
                    : fail(`the agent could not be installed: ${error.message}`)
                ),
                Effect.tapError((error) =>
                  report(id, {
                    message: error.message,
                    phase: "failed",
                    received: 0,
                    total: 0,
                  })
                ),
                Effect.tap(() =>
                  Ref.update(progress, (all) => {
                    const { [id]: _, ...rest } = all;
                    return rest;
                  })
                )
              );
            })
          );
        });

        return AgentDownloads.of({
          download,
          installed,
          offer: (id) => Option.fromNullishOr(releases[id]),
          progress: (id) =>
            Effect.map(Ref.get(progress), (all) =>
              Option.fromNullishOr(all[id])
            ),
        });
      })
    );
}
