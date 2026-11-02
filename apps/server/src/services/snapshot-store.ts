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
 *   design-system setup of one project, the named snapshots of the designs (ADR 0019), the
 *   checkpoints taken before agent turns (ADR 0008), the revision history later. What no ref
 *   keeps is removed, and the objects only it named with it, once every `COLLECT_EVERY` refs
 *   let go of;
 * - `refs/<namespace>/<name>`: a ref the namespace names itself, holding
 *   `{ "id": "<manifest>", "note": "…" }`. Two names of the same files are two refs, let go of
 *   apart, and the note is what the namespace keeps of each (a named snapshot's name and date).
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
interface TreeChange {
  readonly path: string;
  readonly status: "A" | "M" | "D";
}

/** Files given by their contents, by repo-relative path with forward slashes. */
export interface Contents {
  readonly [path: string]: string | Uint8Array;
}

/** A snapshot a namespace keeps under a name of its own, with its note of it. */
interface NamedSnapshot {
  readonly id: string;
  readonly name: string;
  readonly note: string;
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

/** A named ref's file: the snapshot it keeps, and what the namespace notes of it. */
const NamedRefJson = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String, note: Schema.String })
);
const decodeNamedRef = Schema.decodeUnknownEffect(NamedRefJson);
const encodeNamedRef = Schema.encodeEffect(NamedRefJson);

const HASH_RE = /^[0-9a-f]{64}$/;
const NAMESPACE_RE = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
/** A ref's name, a manifest's id or one the namespace gave: no dots, so never a write's temporary file. */
const REF_NAME_RE = /^[A-Za-z0-9_-]+$/;
const SEPARATOR_RE = /[\\/]/g;

/**
 * How many refs are let go of between two collections. Collecting reads every ref and kept
 * manifest and lists every object, so doing it at every release (past 30 checkpoints, every
 * turn) costs what the whole store holds; once every so many, a turn pays that share of it, and
 * what is left over meanwhile is at most the content only these refs kept. The first release
 * of a run collects, so what an earlier run left over goes then.
 */
export const COLLECT_EVERY = 10;

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

const bytesOf = (content: string | Uint8Array) =>
  typeof content === "string" ? new TextEncoder().encode(content) : content;

/** What differs from the files of `before` to those of `after`, both by path to hash. */
const changesOf = (
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>
): TreeChange[] => {
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
};

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
    /**
     * Keeps files given by their contents, as `record` keeps those of a root. With `ref`, the
     * snapshot is kept under the namespace's own name for it, with its note, rather than under
     * its id. Answers the snapshot's id.
     */
    readonly recordContents: (
      namespace: string,
      files: Contents,
      ref?: { readonly name: string; readonly note: string }
    ) => Effect.Effect<string, SnapshotStoreFailed>;
    /**
     * Keeps snapshot `id`, which the store has, under `namespace`'s own name for it with its
     * note: the same files named again, by another namespace or the same one.
     */
    readonly name: (
      namespace: string,
      id: string,
      ref: { readonly name: string; readonly note: string }
    ) => Effect.Effect<void, SnapshotMissing | SnapshotStoreFailed>;
    /** The snapshots `namespace` keeps under names of its own; a ref that does not read is left out. */
    readonly named: (
      namespace: string
    ) => Effect.Effect<readonly NamedSnapshot[]>;
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
    /** The files that differ between snapshot `from` and `files`, as `files` has them. Keeps nothing. */
    readonly changedFrom: (
      from: string,
      files: Contents
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
    /**
     * Stops keeping snapshots for `namespace`, by the refs' names (a snapshot's id, or the name
     * it was recorded under). The manifests no namespace keeps, and the contents no kept
     * manifest names, are removed at the first release of a run and then once every
     * `COLLECT_EVERY` refs let go of.
     */
    readonly release: (
      namespace: string,
      names: Iterable<string>
    ) => Effect.Effect<void>;
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
      /** Refs let go of since the last collection: at first, as many as make one. */
      let released = COLLECT_EVERY;

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

      /** What is in a directory (with `recursive`, every entry below it); nothing when it is not there. */
      const listUnder = (dir: string, recursive = true) =>
        Effect.orElseSucceed(
          fs.readDirectory(dir, { recursive }),
          (): string[] => []
        );

      /** Keeps contents once, by their hash. Answers the hash. */
      const keep = Effect.fnUntraced(function* (
        store: string,
        bytes: Uint8Array,
        what: string
      ) {
        const hash = hashBytes(bytes);
        const object = objectPath(store, hash);
        if (!(yield* Effect.orElseSucceed(fs.exists(object), () => false))) {
          yield* writeAtomic(object, bytes).pipe(
            Effect.mapError(failed(`keeping ${what}`))
          );
        }
        return hash;
      });

      /** Writes the ref that keeps snapshot `id`: under its id, or the namespace's name with its note. */
      const keepRef = Effect.fnUntraced(function* (
        store: string,
        namespace: string,
        id: string,
        ref?: { readonly name: string; readonly note: string }
      ) {
        const content =
          ref === undefined
            ? ""
            : yield* encodeNamedRef({ id, note: ref.note }).pipe(
                Effect.mapError(failed("noting a snapshot"))
              );
        yield* writeAtomic(
          refPath(store, namespace, ref?.name ?? id),
          content
        ).pipe(Effect.mapError(failed("keeping a snapshot")));
      });

      /** A name a namespace can keep a snapshot under. */
      const checkName = (name: string) =>
        REF_NAME_RE.test(name)
          ? Effect.void
          : Effect.fail(
              new SnapshotStoreFailed({
                message: `not a name a snapshot can be kept under: ${name}`,
              })
            );

      /**
       * Writes the manifest of `kept` unless the store has it, then the ref that keeps it: the
       * snapshot's id, or the namespace's name for it with its note.
       */
      const keepManifest = Effect.fnUntraced(function* (
        store: string,
        namespace: string,
        kept: Readonly<Record<string, string>>,
        ref?: { readonly name: string; readonly note: string }
      ) {
        const id = manifestId(kept);
        const manifest = manifestPath(store, id);
        if (!(yield* Effect.orElseSucceed(fs.exists(manifest), () => false))) {
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
        yield* keepRef(store, namespace, id, ref);
        return id;
      });

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
        const hash = yield* keep(store, bytes.value, abs);
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
          return yield* keepManifest(store, namespace, kept);
        },
        (effect) => lock.withPermits(1)(effect)
      );

      const recordContents = Effect.fn("SnapshotStore.recordContents")(
        function* (
          namespace: string,
          files: Contents,
          ref?: { readonly name: string; readonly note: string }
        ) {
          yield* checkNamespace(namespace);
          if (ref !== undefined) {
            yield* checkName(ref.name);
          }
          const store = yield* storeDir;
          const hashes = yield* Effect.forEach(
            Object.entries(files),
            ([file, content]) =>
              Effect.map(
                keep(store, bytesOf(content), file),
                (hash) => [file, hash] as const
              ),
            { concurrency: CONCURRENCY }
          );
          return yield* keepManifest(
            store,
            namespace,
            Object.fromEntries(hashes),
            ref
          );
        },
        (effect) => lock.withPermits(1)(effect)
      );

      const isFile = (file: string) =>
        Effect.orElseSucceed(
          Effect.map(fs.stat(file), (info) => info.type === "File"),
          () => false
        );

      /** What a ref keeps: its name when it is empty, the id it holds when it is named. */
      const refOf = Effect.fnUntraced(function* (file: string) {
        const content = yield* fs.readFileString(file);
        if (content === "") {
          return { id: path.basename(file), named: false, note: "" };
        }
        return { ...(yield* decodeNamedRef(content)), named: true };
      });

      const named = Effect.fn("SnapshotStore.named")(function* (
        namespace: string
      ) {
        yield* checkNamespace(namespace);
        const dir = path.join(yield* storeDir, "refs", namespace);
        const out: NamedSnapshot[] = [];
        for (const name of yield* listUnder(dir, false)) {
          if (!REF_NAME_RE.test(name)) {
            continue;
          }
          const file = path.join(dir, name);
          if (!(yield* isFile(file))) {
            continue;
          }
          const ref = yield* refOf(file).pipe(
            Effect.tapError((error) =>
              Effect.logWarning(`${file} does not read: ${error.message}`)
            ),
            Effect.option
          );
          if (Option.isSome(ref) && ref.value.named) {
            out.push({ id: ref.value.id, name, note: ref.value.note });
          }
        }
        return out;
      });

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

      const nameSnapshot = Effect.fn("SnapshotStore.name")(
        function* (
          namespace: string,
          id: string,
          ref: { readonly name: string; readonly note: string }
        ) {
          yield* checkNamespace(namespace);
          yield* checkName(ref.name);
          // A ref of a manifest the store does not have would keep nothing.
          yield* read(id);
          yield* keepRef(yield* storeDir, namespace, id, ref);
        },
        (effect) => lock.withPermits(1)(effect)
      );

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
          return changesOf((yield* read(from)).files, (yield* read(to)).files);
        }
      );

      const changedFrom = Effect.fn("SnapshotStore.changedFrom")(function* (
        from: string,
        files: Contents
      ) {
        const after = Object.fromEntries(
          Object.entries(files).map(([file, content]) => [
            file,
            hashBytes(bytesOf(content)),
          ])
        );
        return changesOf((yield* read(from)).files, after);
      });

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

      /** The snapshots every namespace keeps; null when a ref does not read. */
      const keptByRefs = Effect.fnUntraced(function* (store: string) {
        const refs = path.join(store, "refs");
        const kept = new Set<string>();
        for (const entry of yield* listUnder(refs)) {
          const file = path.join(refs, entry);
          if (
            !(REF_NAME_RE.test(path.basename(entry)) && (yield* isFile(file)))
          ) {
            continue;
          }
          const ref = yield* Effect.option(refOf(file));
          if (Option.isNone(ref)) {
            yield* Effect.logWarning(
              `The snapshot store is not cleaned up: ${file} does not read.`
            );
            return null;
          }
          kept.add(ref.value.id);
        }
        return kept;
      });

      /** Removes the manifests no namespace keeps, and the contents no kept manifest names. */
      const collect = Effect.fn("SnapshotStore.collect")(function* (
        store: string
      ) {
        const kept = yield* keptByRefs(store);
        if (kept === null) {
          // Which snapshot a ref keeps is not known: nothing is removed on a guess.
          return;
        }
        const listed = new Set<string>();
        for (const name of yield* listUnder(path.join(store, "manifests"))) {
          const id = path.basename(name, ".json");
          if (!kept.has(id)) {
            yield* Effect.ignore(fs.remove(manifestPath(store, id)));
            continue;
          }
          const manifest = yield* Effect.option(read(id));
          if (Option.isSome(manifest)) {
            for (const hash of Object.values(manifest.value.files)) {
              listed.add(hash);
            }
          }
        }
        for (const name of yield* listUnder(path.join(store, "objects"))) {
          const hash = name.replace(SEPARATOR_RE, "");
          if (HASH_RE.test(hash) && !listed.has(hash)) {
            yield* Effect.ignore(fs.remove(objectPath(store, hash)));
          }
        }
      });

      const release = Effect.fn("SnapshotStore.release")(
        function* (namespace: string, names: Iterable<string>) {
          yield* checkNamespace(namespace);
          const store = yield* storeDir;
          for (const name of new Set(names)) {
            if (REF_NAME_RE.test(name)) {
              // A ref already gone is what was wanted.
              yield* Effect.ignore(fs.remove(refPath(store, namespace, name)));
              released += 1;
            }
          }
          if (released >= COLLECT_EVERY) {
            released = 0;
            yield* collect(store);
          }
        },
        (effect) => lock.withPermits(1)(effect)
      );

      return SnapshotStore.of({
        changedBetween,
        changedFrom,
        name: nameSnapshot,
        named,
        read,
        readFile,
        record,
        recordContents,
        release,
        restore,
      });
    })
  );
}
