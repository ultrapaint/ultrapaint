/**
 * The tool's own snapshots of files, in the state directory and without git (PLAN-desktop D10):
 * each file's contents once, by their hash, and a manifest per snapshot naming the hash of every
 * file it has. A snapshot costs what changed since the last one; an unchanged file is shared.
 *
 * In `<stateDir>/store/`:
 * - `objects/ab/cdef…`: a file's bytes, named by their SHA-256;
 * - `manifests/<id>.json`: `{ "version": 1, "files": { "<path>": "<hash>" } }`, named by the hash
 *   of what it lists, so the same files are the same snapshot;
 * - `refs/<namespace>/<id>`: what keeps a manifest. A namespace is whoever records: the
 *   design-system setup of one project today, the revision history later. What no ref keeps is
 *   removed by `collect`, and the objects only it named with it.
 */
import type { RestoreEntry } from "@ultrapaint/contracts/design-system-setup";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  Semaphore,
} from "effect";
import { makeWriteAtomic } from "../atomic-write.ts";
import { hashBytes } from "../hash.ts";
import { Storage } from "./storage.ts";

/** What a snapshot holds: each file, repo-relative with forward slashes, by its contents' hash. */
export const Manifest = Schema.Struct({
  files: Schema.Record(Schema.String, Schema.String),
  version: Schema.Literal(1),
});
export type Manifest = typeof Manifest.Type;

/** A file that differs between two snapshots: added, modified or deleted in the second. */
export interface TreeChange {
  readonly path: string;
  readonly status: "A" | "M" | "D";
}

/** A snapshot, or a file's contents, that the store does not have (any longer). */
export class SnapshotMissing extends Schema.TaggedError<SnapshotMissing>()(
  "SnapshotMissing",
  { id: Schema.String, message: Schema.String }
) {}

/** The store could not be written: a full disk, a state directory gone. */
export class SnapshotStoreFailed extends Schema.TaggedError<SnapshotStoreFailed>()(
  "SnapshotStoreFailed",
  { message: Schema.String }
) {}

const ManifestJson = Schema.fromJsonString(Manifest);
const decodeManifest = Schema.decodeUnknownEffect(ManifestJson);

const HASH_RE = /^[0-9a-f]{64}$/;
const NAMESPACE_RE = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const SEPARATOR_RE = /[\\/]/g;

/** Files read and written together while a snapshot is taken or put back. */
const CONCURRENCY = 16;

/**
 * How long after its last write a file's time is trusted to tell it unchanged: a file written
 * twice within the filesystem's resolution keeps its time, and a hash taken in between would
 * be kept for content it no longer has.
 */
const RACY_MS = 2000;

/** A file's hash as last taken, and its time and size then. */
interface Hashed {
  readonly at: number;
  readonly hash: string;
  readonly mtimeMs: number;
  readonly size: number;
}

/** The manifest's own name: the hash of the files it lists, in order. */
const manifestId = (files: Readonly<Record<string, string>>) =>
  hashBytes(
    new TextEncoder().encode(
      Object.keys(files)
        .sort()
        .map((file) => `${files[file]} ${file}\n`)
        .join("")
    )
  );

export class SnapshotStore extends Context.Service<
  SnapshotStore,
  {
    /**
     * Takes `files` of `root` as they are now, keeps their contents, and records a manifest of
     * them kept under `namespace`. A file gone meanwhile is left out. Answers the snapshot's id.
     */
    readonly record: (
      namespace: string,
      root: string,
      files: readonly string[]
    ) => Effect.Effect<string, SnapshotStoreFailed>;
    readonly read: (id: string) => Effect.Effect<Manifest, SnapshotMissing>;
    /** A file's contents as a snapshot has them, by the hash its manifest gives. */
    readonly readFile: (
      hash: string
    ) => Effect.Effect<Uint8Array, SnapshotMissing>;
    /** The files that differ between two snapshots, as the second has them. */
    readonly changedBetween: (
      from: string,
      to: string
    ) => Effect.Effect<readonly TreeChange[], SnapshotMissing>;
    /**
     * Puts files of `root` back as snapshot `id` has them, and removes those the entries say to.
     * The caller has checked the paths: the store writes where it is told.
     */
    readonly restore: (
      id: string,
      root: string,
      entries: readonly RestoreEntry[]
    ) => Effect.Effect<void, SnapshotMissing | SnapshotStoreFailed>;
    /** Stops keeping snapshots for `namespace`; `collect` removes what nothing keeps. */
    readonly release: (
      namespace: string,
      ids: Iterable<string>
    ) => Effect.Effect<void>;
    /** Removes the manifests no namespace keeps, and the contents no kept manifest names. */
    readonly collect: Effect.Effect<void>;
  }
>()("ultrapaint/server/SnapshotStore") {
  static readonly layer = Layer.effect(
    SnapshotStore,
    Effect.gen(function* () {
      const storage = yield* Storage;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      // A record and a collection never interleave: a collection would take the contents of a
      // snapshot whose manifest is not written yet for nobody's.
      const lock = yield* Semaphore.make(1);
      /** Hashes taken before, by absolute path, so an unchanged file is not read again. */
      const hashed = new Map<string, Hashed>();

      // Asked each time: saving an unsaved session moves the state directory.
      const storeDir = Effect.map(storage.stateDir, (dir) =>
        path.join(dir, "store")
      );
      const objectPath = (store: string, hash: string) =>
        path.join(store, "objects", hash.slice(0, 2), hash.slice(2));
      const manifestPath = (store: string, id: string) =>
        path.join(store, "manifests", `${id}.json`);
      const refPath = (store: string, namespace: string, id: string) =>
        path.join(store, "refs", namespace, id);

      const failed = (what: string) => (error: { readonly message: string }) =>
        new SnapshotStoreFailed({ message: `${what}: ${error.message}` });

      /** The file's hash, read again only when its time or size moved since the last time. */
      const hashOf = Effect.fnUntraced(function* (store: string, abs: string) {
        const info = yield* Effect.option(fs.stat(abs));
        if (Option.isNone(info) || info.value.type !== "File") {
          return null;
        }
        const mtimeMs = Option.match(info.value.mtime, {
          onNone: () => 0,
          onSome: (date) => date.getTime(),
        });
        const size = Number(info.value.size);
        const known = hashed.get(abs);
        if (
          known &&
          known.mtimeMs === mtimeMs &&
          known.size === size &&
          known.at - mtimeMs > RACY_MS
        ) {
          return known.hash;
        }
        const bytes = yield* Effect.option(fs.readFile(abs));
        if (Option.isNone(bytes)) {
          return null;
        }
        const hash = hashBytes(bytes.value);
        const object = objectPath(store, hash);
        // The same contents are kept once.
        if (!(yield* Effect.orElseSucceed(fs.exists(object), () => false))) {
          yield* writeAtomic(object, bytes.value).pipe(
            Effect.mapError(failed(`keeping ${abs}`))
          );
        }
        hashed.set(abs, {
          at: yield* Clock.currentTimeMillis,
          hash,
          mtimeMs,
          size,
        });
        return hash;
      });

      const checkNamespace = (namespace: string) =>
        NAMESPACE_RE.test(namespace)
          ? Effect.void
          : Effect.die(new Error(`not a snapshot namespace: ${namespace}`));

      const record = Effect.fn("SnapshotStore.record")(
        function* (namespace: string, root: string, files: readonly string[]) {
          yield* checkNamespace(namespace);
          const store = yield* storeDir;
          const hashes = yield* Effect.forEach(
            files,
            (file) =>
              Effect.map(
                hashOf(store, path.join(root, file)),
                (hash) => [file, hash] as const
              ),
            { concurrency: CONCURRENCY }
          );
          const kept: Record<string, string> = {};
          for (const [file, hash] of hashes) {
            if (hash !== null) {
              kept[file] = hash;
            }
          }
          const id = manifestId(kept);
          const manifest = manifestPath(store, id);
          if (
            !(yield* Effect.orElseSucceed(fs.exists(manifest), () => false))
          ) {
            const sorted = Object.fromEntries(
              Object.keys(kept)
                .sort()
                .map((file) => [file, kept[file]])
            );
            yield* writeAtomic(
              manifest,
              `${JSON.stringify({ files: sorted, version: 1 })}\n`
            ).pipe(Effect.mapError(failed("writing a snapshot")));
          }
          yield* writeAtomic(refPath(store, namespace, id), "").pipe(
            Effect.mapError(failed("keeping a snapshot"))
          );
          return id;
        },
        (effect) => lock.withPermits(1)(effect)
      );

      const missing = (id: string, what: string) => () =>
        new SnapshotMissing({
          id,
          message: `The snapshot store has no ${what} ${id}.`,
        });

      const read = Effect.fn("SnapshotStore.read")(function* (id: string) {
        if (!HASH_RE.test(id)) {
          return yield* missing(id, "snapshot")();
        }
        const store = yield* storeDir;
        return yield* fs
          .readFileString(manifestPath(store, id))
          .pipe(
            Effect.flatMap(decodeManifest),
            Effect.mapError(missing(id, "snapshot"))
          );
      });

      const readFile = Effect.fn("SnapshotStore.readFile")(function* (
        hash: string
      ) {
        if (!HASH_RE.test(hash)) {
          return yield* missing(hash, "file")();
        }
        const store = yield* storeDir;
        return yield* fs
          .readFile(objectPath(store, hash))
          .pipe(Effect.mapError(missing(hash, "file")));
      });

      const changedBetween = Effect.fn("SnapshotStore.changedBetween")(
        function* (from: string, to: string) {
          if (from === to) {
            return [];
          }
          const before = (yield* read(from)).files;
          const after = (yield* read(to)).files;
          const changes: TreeChange[] = [];
          for (const [file, hash] of Object.entries(after)) {
            const was = before[file];
            if (was === undefined) {
              changes.push({ path: file, status: "A" });
            } else if (was !== hash) {
              changes.push({ path: file, status: "M" });
            }
          }
          for (const file of Object.keys(before)) {
            if (after[file] === undefined) {
              changes.push({ path: file, status: "D" });
            }
          }
          return changes.sort((a, b) =>
            a.path < b.path ? -1 : Number(a.path > b.path)
          );
        }
      );

      /** Writes the snapshot's contents over the file, keeping the permissions it had. */
      const putBack = Effect.fnUntraced(function* (abs: string, hash: string) {
        const bytes = yield* readFile(hash);
        const mode = Option.map(
          yield* Effect.option(fs.stat(abs)),
          // The permission bits, the low nine.
          (info) => info.mode % 0o1000
        );
        yield* writeAtomic(abs, bytes, {
          ...(Option.isSome(mode) && { mode: mode.value }),
        }).pipe(Effect.mapError(failed(`putting back ${abs}`)));
      });

      const restore = Effect.fn("SnapshotStore.restore")(function* (
        id: string,
        root: string,
        entries: readonly RestoreEntry[]
      ) {
        const { files } = yield* read(id);
        yield* Effect.forEach(
          entries,
          (entry) => {
            const abs = path.join(root, entry.path);
            if (entry.action === "delete") {
              // Already gone is what was asked for.
              return Effect.ignore(fs.remove(abs));
            }
            const hash = files[entry.path];
            return hash === undefined
              ? Effect.fail(
                  new SnapshotMissing({
                    id,
                    message: `The snapshot has no ${entry.path} to put back.`,
                  })
                )
              : putBack(abs, hash);
          },
          { concurrency: CONCURRENCY, discard: true }
        );
      });

      const release = Effect.fn("SnapshotStore.release")(
        function* (namespace: string, ids: Iterable<string>) {
          yield* checkNamespace(namespace);
          const store = yield* storeDir;
          for (const id of new Set(ids)) {
            if (HASH_RE.test(id)) {
              // A ref already gone is what was wanted.
              yield* Effect.ignore(fs.remove(refPath(store, namespace, id)));
            }
          }
        },
        (effect) => lock.withPermits(1)(effect)
      );

      /** Every file under a directory, relative to it; nothing when it is not there. */
      const listUnder = (dir: string) =>
        Effect.orElseSucceed(
          fs.readDirectory(dir, { recursive: true }),
          (): string[] => []
        );

      const collect = Effect.gen(function* () {
        const store = yield* storeDir;
        const kept = new Set(
          (yield* listUnder(path.join(store, "refs"))).map((ref) =>
            path.basename(ref)
          )
        );
        const named = new Set<string>();
        for (const name of yield* listUnder(path.join(store, "manifests"))) {
          const id = path.basename(name, ".json");
          if (!kept.has(id)) {
            yield* Effect.ignore(fs.remove(manifestPath(store, id)));
            continue;
          }
          const manifest = yield* Effect.option(read(id));
          if (Option.isSome(manifest)) {
            for (const hash of Object.values(manifest.value.files)) {
              named.add(hash);
            }
          }
        }
        for (const name of yield* listUnder(path.join(store, "objects"))) {
          const hash = name.replace(SEPARATOR_RE, "");
          if (HASH_RE.test(hash) && !named.has(hash)) {
            yield* Effect.ignore(fs.remove(objectPath(store, hash)));
          }
        }
      }).pipe(lock.withPermits(1), Effect.withSpan("SnapshotStore.collect"));

      return SnapshotStore.of({
        changedBetween,
        collect,
        read,
        readFile,
        record,
        release,
        restore,
      });
    })
  );
}
