/**
 * The designs' history (ADR 0087): Ultrapaint's own record of how the design files changed,
 * kept in the snapshot store whether the project is a git repository or not, and never let go
 * of. Each point is the designs right after something happened to them:
 *
 * - the person's edits, closed two minutes after the last one, ten minutes after the first while
 *   they go on, and before anything else writes (an agent's turn, a change from outside, a
 *   restore, a version saved);
 * - an agent's turn, from its prompt to its end: what the person or the watcher sees meanwhile
 *   is the turn's;
 * - the files changed by something else (a pull, a checkout, a text editor), once they settle,
 *   and the files as they are found when the project opens;
 * - a restore, the designs put back as a point kept them, in one undo step.
 *
 * A point the person names is a version. Each point keeps every design file but the comments,
 * as the snapshot store keeps them: a file unchanged from one point to the next is kept once.
 * The editor is told the points as one is made or named (`history`), and the person's edits not
 * in a point yet as they come (`history.pending`).
 */
import { DESIGN_NOTES_FILE } from "@ultrapaint/contracts/design-system";
import { NotFound } from "@ultrapaint/contracts/errors";
import type {
  History as HistoryList,
  HistoryPoint,
  PageChange,
  PendingEdits,
  PointKind,
  PointView,
} from "@ultrapaint/contracts/snapshots";
import { HistoryPoint as HistoryPointSchema } from "@ultrapaint/contracts/snapshots";
import { isPageFile } from "@ultrapaint/design-document/tree";
import { CANVAS_FILE, ROOT_CANVAS } from "@ultrapaint/shared/canvas";
import { basename, humanise } from "@ultrapaint/shared/path";
import {
  Clock,
  Context,
  Duration,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Path,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { EventBus } from "../events.ts";
import { makeWalk } from "../fs-walk.ts";
import { hashContent, toPosix } from "../hash.ts";
import { makeId, newestFirst } from "../ids.ts";
import { COMMENTS_FILE } from "./comments-file.ts";
import { DesignFiles } from "./design-files.ts";
import { parseDocument } from "./document-file.ts";
import { type EditFailure, EditService } from "./edit.ts";
import { pointViewOf } from "./history-view.ts";
import { RepoPaths } from "./repo-paths.ts";
import { type Contents, SnapshotStore } from "./snapshot-store.ts";

/** The snapshot store's namespace of the history's points. */
const NAMESPACE = "history";
/** The namespaces kept before the history was: named snapshots, and agent turns' checkpoints. */
const LEGACY_SNAPSHOTS = "designs";
const LEGACY_CHECKPOINTS = "checkpoints";

/** The person's edits close this long after the last one. */
export const EDITS_IDLE = Duration.minutes(2);
/** And this long after the first, while they go on. */
export const EDITS_STRETCH = Duration.minutes(10);
/** Files changed from outside are one point once nothing more has changed for this long. */
export const OUTSIDE_SETTLE = Duration.seconds(1);
/** Writes this close together are one edit, as a step of the journal writes several files. */
const ONE_EDIT_MS = 500;

const DESIGN_FILE_RE = /\.(tsx?|json|css|md)$/;
const TRAILING_SLASH_RE = /\/$/;
/** What checkpoints kept before 11 Nov 2026 began their prompt with. */
const OLD_PREFIX_RE = /^Before: /;

/** What a point's ref notes beside the files: the point, and the repository it was taken in. */
const Note = Schema.Struct({
  point: HistoryPointSchema,
  repo: Schema.optional(Schema.String),
});
const NoteJson = Schema.fromJsonString(Note);
const decodeNote = Schema.decodeUnknownEffect(NoteJson);
const encodeNote = Schema.encodeEffect(NoteJson);

/** What the legacy namespaces' refs noted. */
const LegacyNote = Schema.Struct({
  checkpoint: Schema.optional(
    Schema.Struct({
      at: Schema.Number,
      id: Schema.String,
      label: Schema.String,
    })
  ),
  repo: Schema.optional(Schema.String),
  snapshot: Schema.optional(
    Schema.Struct({ at: Schema.Number, id: Schema.String, name: Schema.String })
  ),
});
const decodeLegacy = Schema.decodeUnknownEffect(
  Schema.fromJsonString(LegacyNote)
);

/** A snapshot or a checkpoint kept before the history was, as its point; null when it says no time. */
const legacyPoint = (
  note: typeof LegacyNote.Type,
  id: string
): HistoryPoint | null => {
  const { checkpoint, snapshot } = note;
  const at = snapshot?.at ?? checkpoint?.at;
  if (at === undefined) {
    return null;
  }
  return {
    at,
    canvases: [],
    files: [],
    id,
    kind: "imported",
    ...(snapshot
      ? { label: snapshot.name, name: snapshot.name }
      : {
          label: `Before “${(checkpoint?.label ?? "").replace(OLD_PREFIX_RE, "")}”`,
        }),
  };
};

/** A point with the store's snapshot of its files. */
type Kept = HistoryPoint & { readonly tree: string };

const byTime = newestFirst<HistoryPoint>(
  (p) => p.at,
  (p) => p.id
);

/** A turn begun: what its point will say. */
export interface TurnStart {
  readonly agentId: string;
  /** Its prompt. */
  readonly label: string;
  readonly model?: string | undefined;
}

/** What a point says of what was put back, in a few words. */
export const wordsOf = (point: HistoryPoint): string =>
  point.name ??
  point.label ??
  (point.kind === "edits" ? "Your edits" : "The designs");

export class History extends Context.Service<
  History,
  {
    /** The points, newest first, and the person's edits not in one yet. */
    readonly get: Effect.Effect<HistoryList>;
    /** A turn begins: the person's edits are closed first; what changes is the turn's. */
    readonly turnStarted: (
      threadId: string,
      turn: TurnStart
    ) => Effect.Effect<void>;
    /** A turn ended, whichever way: its point, when it changed anything. */
    readonly turnEnded: (threadId: string) => Effect.Effect<void>;
    /** Names a point, or the designs as they are now; a version. */
    readonly save: (
      name: string,
      id?: string
    ) => Effect.Effect<HistoryPoint, NotFound>;
    /** A point's name; null takes it out of the versions. */
    readonly rename: (
      id: string,
      name: string | null
    ) => Effect.Effect<void, NotFound>;
    /** The designs put back as the point kept them: one undo step, and a point of its own. */
    readonly restore: (
      id: string
    ) => Effect.Effect<void, NotFound | EditFailure>;
    /** The pages the point changed, before it and after it. */
    readonly compare: (id: string) => Effect.Effect<PageChange[], NotFound>;
    /** The designs as the point kept them, to look at. */
    readonly view: (id: string) => Effect.Effect<PointView, NotFound>;
  }
>()("ultrapaint/server/History") {
  static readonly layer = Layer.effect(
    History,
    Effect.gen(function* () {
      const store = yield* SnapshotStore;
      const events = yield* EventBus;
      const paths = yield* RepoPaths;
      const designFilesService = yield* DesignFiles;
      const edit = yield* EditService;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const scope = yield* Effect.scope;
      const walk = makeWalk(fs, path);
      const lock = Semaphore.makeUnsafe(1);
      const repo = paths.root;
      const designsRel = toPosix(paths.relative(paths.designsDir));
      const designsPrefix = designsRel === "" ? "" : `${designsRel}/`;

      /** Every point of this repository, newest first. */
      let points: Kept[] = [];
      /** The hash of each file as the newest point kept it: a write of the same is no change. */
      let latestHashes = new Map<string, string>();
      let pending: { edits: number; since: number; last: number } | null = null;
      let editsTimer: Fiber.Fiber<void> | null = null;
      const outside = new Set<string>();
      let outsideTimer: Fiber.Fiber<void> | null = null;
      const turns = new Map<string, TurnStart>();

      /**
       * Every text file of the designs but the comments, and DESIGN.md beside them: what a
       * point keeps. Images are left out; they are not in the undo journal either.
       */
      const designFiles = Effect.gen(function* () {
        const files = yield* walk(paths.designsDir, {
          includeFile: (name) => DESIGN_FILE_RE.test(name),
          skipDir: (name) => name === "node_modules" || name.startsWith("."),
        }).pipe(Effect.orElseSucceed((): string[] => []));
        const notes = path.join(paths.root, DESIGN_NOTES_FILE);
        const all = files.includes(notes) ? files : [...files, notes];
        const entries = yield* Effect.forEach(all, (abs) =>
          Effect.map(Effect.option(fs.readFileString(abs)), (content) =>
            content._tag === "Some"
              ? ([paths.relative(abs), content.value] as const)
              : null
          )
        );
        const out: { [file: string]: string } = {};
        for (const entry of entries) {
          if (entry && basename(entry[0]) !== COMMENTS_FILE) {
            out[entry[0]] = entry[1];
          }
        }
        return out;
      });

      /** The canvas a design file belongs to; null for a file of no canvas (a component). */
      const canvasesOf = (files: readonly string[], all: readonly string[]) => {
        const canvasDirs = all
          .filter(
            (f) => f.startsWith(designsPrefix) && basename(f) === CANVAS_FILE
          )
          .map((f) =>
            f
              .slice(designsPrefix.length, -CANVAS_FILE.length)
              .replace(TRAILING_SLASH_RE, "")
          )
          .sort((a, b) => b.length - a.length);
        const found = new Set<string>();
        for (const file of files) {
          if (!file.startsWith(designsPrefix)) {
            continue;
          }
          const rel = file.slice(designsPrefix.length);
          const name = basename(rel);
          if (!(isPageFile(name) || name === CANVAS_FILE)) {
            continue;
          }
          const canvas = canvasDirs.find(
            (dir) => dir !== "" && rel.startsWith(`${dir}/`)
          );
          found.add(canvas ?? ROOT_CANVAS);
        }
        return [...found];
      };

      const listed = (): HistoryPoint[] =>
        points.map(({ tree: _tree, ...point }) => point);

      const publishPoints = events.publish("history", listed());
      const pendingNow = (): PendingEdits | null =>
        pending ? { edits: pending.edits, since: pending.since } : null;
      const publishPending = Effect.suspend(() =>
        events.publish("history.pending", pendingNow())
      );

      const hashesOf = (files: { readonly [file: string]: string }) =>
        new Map(Object.entries(files).map(([f, c]) => [f, hashContent(c)]));

      /** Keeps a point's files and its note; answers the store's snapshot of them. */
      const keep = Effect.fnUntraced(function* (
        point: HistoryPoint,
        files: Contents
      ) {
        const note = yield* encodeNote({ point, repo }).pipe(Effect.orDie);
        return yield* store
          .recordContents(NAMESPACE, files, { name: point.id, note })
          .pipe(Effect.orDie);
      });

      /**
       * A point of `kind` with the designs as they are now (or as `files` says), when they
       * changed since the newest point. Null when nothing changed.
       */
      const record = Effect.fnUntraced(function* (
        kind: PointKind,
        extra: Partial<HistoryPoint> = {},
        given?: { readonly [file: string]: string }
      ) {
        const files = given ?? (yield* designFiles);
        const [latest] = points;
        let changed: string[];
        if (latest) {
          const changes = yield* store
            .changedFrom(latest.tree, files)
            .pipe(Effect.orElseSucceed(() => null));
          changed =
            changes === null ? Object.keys(files) : changes.map((c) => c.path);
          if (changes !== null && changed.length === 0) {
            return null;
          }
        } else {
          changed = Object.keys(files);
        }
        const point: HistoryPoint = {
          ...extra,
          at: yield* Clock.currentTimeMillis,
          canvases: canvasesOf(changed, Object.keys(files)),
          files: changed.sort(),
          id: yield* makeId("hp"),
          kind,
        };
        const tree = yield* keep(point, files);
        points = [{ ...point, tree }, ...points];
        latestHashes = hashesOf(files);
        yield* Effect.suspend(() => publishPoints);
        return point;
      });

      const stopTimer = (fiber: Fiber.Fiber<void> | null) =>
        fiber ? Fiber.interrupt(fiber).pipe(Effect.asVoid) : Effect.void;

      /** The person's edits closed into a point, when there are any. Under the lock. */
      const closeEdits = Effect.gen(function* () {
        const timer = editsTimer;
        editsTimer = null;
        yield* stopTimer(timer);
        if (!pending) {
          return;
        }
        const { edits, since } = pending;
        pending = null;
        yield* record("edits", { edits, from: since });
        yield* publishPending;
      });

      /** The files changed from outside, a point once they settle. Under the lock. */
      const closeOutside = Effect.gen(function* () {
        const timer = outsideTimer;
        outsideTimer = null;
        yield* stopTimer(timer);
        if (outside.size === 0) {
          return;
        }
        const files = yield* designFiles;
        // The person's edits first, without what came from outside: those files as the newest
        // point had them.
        if (pending) {
          const [latest] = points;
          const before: { readonly [file: string]: string } = latest
            ? yield* textsOf(latest, [...outside]).pipe(
                Effect.orElseSucceed(() => ({}))
              )
            : {};
          const mine: { [file: string]: string } = { ...files };
          for (const file of outside) {
            const was = before[file];
            if (was === undefined) {
              delete mine[file];
            } else {
              mine[file] = was;
            }
          }
          const { edits, since } = pending;
          pending = null;
          const running = editsTimer;
          editsTimer = null;
          yield* stopTimer(running);
          yield* record("edits", { edits, from: since }, mine);
          yield* publishPending;
        }
        outside.clear();
        yield* record("outside", {}, files);
      });

      /** Everything not in a point yet closed into points, before something else writes. */
      const settle = Effect.andThen(closeOutside, closeEdits);

      const locked = <A, E>(effect: Effect.Effect<A, E>) =>
        lock.withPermits(1)(effect);

      /** A timer that closes something, under the lock, unless it is interrupted first. */
      const timer = (wait: Duration.Duration, close: Effect.Effect<void>) =>
        Effect.forkIn(Effect.andThen(Effect.sleep(wait), locked(close)), scope);

      const restartEditsTimer = Effect.gen(function* () {
        if (!pending) {
          return;
        }
        const now = yield* Clock.currentTimeMillis;
        const stretchLeft =
          pending.since + Duration.toMillis(EDITS_STRETCH) - now;
        const wait = Math.max(
          0,
          Math.min(Duration.toMillis(EDITS_IDLE), stretchLeft)
        );
        const old = editsTimer;
        editsTimer = null;
        yield* stopTimer(old);
        editsTimer = yield* timer(
          Duration.millis(wait),
          Effect.suspend(() => {
            // The timer is done with: closing does not interrupt the fiber it runs on.
            editsTimer = null;
            return closeEdits;
          })
        );
      });

      /** A change of the designs, by whoever wrote it. Under the lock. */
      const heard = Effect.fnUntraced(function* (change: {
        readonly by: { readonly _tag: string };
        readonly file: string;
        readonly hash: string;
      }) {
        // A turn's: its point says so when it ends.
        if (turns.size > 0) {
          return;
        }
        // The newest point already has it: a restore's own writes, an echo, an undo back.
        if ((latestHashes.get(change.file) ?? "") === change.hash) {
          return;
        }
        const now = yield* Clock.currentTimeMillis;
        if (change.by._tag === "Unknown") {
          outside.add(change.file);
          const old = outsideTimer;
          outsideTimer = null;
          yield* stopTimer(old);
          outsideTimer = yield* timer(
            OUTSIDE_SETTLE,
            Effect.suspend(() => {
              outsideTimer = null;
              return closeOutside;
            })
          );
          return;
        }
        if (pending === null) {
          pending = { edits: 1, last: now, since: now };
        } else if (now - pending.last > ONE_EDIT_MS) {
          pending = { ...pending, edits: pending.edits + 1, last: now };
        } else {
          pending = { ...pending, last: now };
        }
        yield* publishPending;
        yield* restartEditsTimer;
      });

      /** The text of `files` as the point kept them; all of them when none are named. */
      const textsOf = Effect.fnUntraced(function* (
        point: Kept,
        files?: readonly string[]
      ) {
        const manifest = yield* store.read(point.tree);
        const wanted = files ?? Object.keys(manifest.files);
        const decoder = new TextDecoder();
        const texts: { [file: string]: string } = {};
        for (const file of wanted) {
          const hash = manifest.files[file];
          if (hash !== undefined) {
            texts[file] = decoder.decode(yield* store.readFile(hash));
          }
        }
        return texts;
      });

      const find = (id: string) =>
        Effect.suspend(() => {
          const found = points.find((p) => p.id === id);
          return found
            ? Effect.succeed(found)
            : Effect.fail(
                new NotFound({ message: "unknown point of the history" })
              );
        });

      const gone = (error: { readonly message: string }) =>
        new NotFound({
          message: `The point's files are no longer kept: ${error.message}`,
        });

      /** A point's note written again, its files as they are: a name given or taken. */
      const renote = Effect.fnUntraced(function* (point: Kept) {
        const { tree, ...rest } = point;
        const note = yield* encodeNote({ point: rest, repo }).pipe(
          Effect.orDie
        );
        yield* store.name(NAMESPACE, tree, { name: rest.id, note }).pipe(
          Effect.catchTags({
            SnapshotMissing: (error) => Effect.fail(gone(error)),
            SnapshotStoreFailed: Effect.die,
          })
        );
        points = points.map((p) => (p.id === point.id ? point : p));
        yield* Effect.suspend(() => publishPoints);
      });

      // ---- opening: the points kept, the old namespaces brought in, the files as found ----

      const readPoints = Effect.gen(function* () {
        const out: Kept[] = [];
        for (const ref of yield* store.named(NAMESPACE)) {
          const note = yield* Effect.option(decodeNote(ref.note));
          if (
            note._tag === "Some" &&
            note.value.point.id === ref.name &&
            (note.value.repo === undefined || note.value.repo === repo)
          ) {
            out.push({ ...note.value.point, tree: ref.id });
          }
        }
        return out.sort(byTime);
      });

      /** The snapshots and checkpoints kept before the history was, as its points. */
      const importLegacy = Effect.gen(function* () {
        const found: Kept[] = [];
        for (const namespace of [LEGACY_SNAPSHOTS, LEGACY_CHECKPOINTS]) {
          for (const ref of yield* store.named(namespace)) {
            const note = yield* Effect.option(decodeLegacy(ref.note));
            if (
              note._tag === "None" ||
              (note.value.repo !== undefined && note.value.repo !== repo)
            ) {
              continue;
            }
            const point = legacyPoint(note.value, yield* makeId("hp"));
            if (point === null) {
              continue;
            }
            const noted = yield* encodeNote({ point, repo }).pipe(Effect.orDie);
            const kept = yield* Effect.option(
              store.name(NAMESPACE, ref.id, { name: point.id, note: noted })
            );
            if (kept._tag === "Some") {
              found.push({ ...point, tree: ref.id });
            }
          }
        }
        return found.sort(byTime);
      });

      points = yield* readPoints;
      if (points.length === 0) {
        points = yield* importLegacy;
      }
      {
        const files = yield* designFiles;
        const [latest] = points;
        if (latest) {
          latestHashes = hashesOf(
            yield* textsOf(latest).pipe(Effect.orElseSucceed(() => ({})))
          );
        }
        yield* record(
          latest && latest.kind !== "imported" ? "outside" : "start",
          {},
          files
        );
      }

      // ---- following the designs' changes ----

      yield* designFilesService
        .changes([
          "canvas",
          "canvases",
          "component",
          "designSystem",
          "implementation",
          "notes",
          "page",
          "tokens",
        ])
        .pipe(
          Stream.runForEach((change) => locked(heard(change))),
          Effect.ignore({ log: true }),
          Effect.forkScoped
        );

      // ---- what the editor and the turns ask ----

      const get = Effect.sync(
        (): HistoryList => ({ pending: pendingNow(), points: listed() })
      );

      const turnStarted = (threadId: string, turn: TurnStart) =>
        locked(
          Effect.gen(function* () {
            if (turns.size === 0) {
              yield* settle;
            }
            turns.set(threadId, turn);
          })
        );

      const turnEnded = (threadId: string) =>
        locked(
          Effect.gen(function* () {
            const turn = turns.get(threadId);
            if (!turn) {
              return;
            }
            turns.delete(threadId);
            yield* record("turn", {
              agentId: turn.agentId,
              label: turn.label,
              threadId,
              ...(turn.model === undefined ? {} : { model: turn.model }),
            });
          })
        );

      const save = (name: string, id?: string) =>
        locked(
          Effect.gen(function* () {
            const named = name.trim() || "Version";
            if (id === undefined) {
              yield* settle;
            }
            const point = id === undefined ? points[0] : yield* find(id);
            if (!point) {
              return yield* new NotFound({ message: "nothing to name yet" });
            }
            const renamed = { ...point, name: named };
            yield* renote(renamed);
            const { tree: _tree, ...out } = renamed;
            return out satisfies HistoryPoint;
          })
        );

      const rename = (id: string, name: string | null) =>
        locked(
          Effect.gen(function* () {
            const point = yield* find(id);
            const { name: _old, ...rest } = point;
            const trimmed = name?.trim();
            yield* renote(trimmed ? { ...rest, name: trimmed } : rest);
          })
        );

      const restore = (id: string) =>
        locked(
          Effect.gen(function* () {
            const point = yield* find(id);
            yield* settle;
            const current = yield* designFiles;
            const changes = yield* store
              .changedFrom(point.tree, current)
              .pipe(Effect.mapError(gone));
            if (changes.length === 0) {
              return;
            }
            const before = yield* textsOf(
              point,
              changes.filter((c) => c.status !== "A").map((c) => c.path)
            ).pipe(Effect.mapError(gone));
            const words = wordsOf(point);
            yield* edit.transaction(`Restore ${words}`, (tx) =>
              Effect.forEach(
                changes,
                (change) =>
                  change.status === "A"
                    ? tx.remove(change.path)
                    : tx.write(change.path, before[change.path] ?? ""),
                { discard: true }
              )
            );
            yield* record("restore", { label: words });
          })
        );

      const compare = Effect.fn("History.compare")(function* (id: string) {
        const point = yield* find(id);
        const index = points.indexOf(point);
        const previous = points[index + 1];
        const pages = point.files.filter((f) => isPageFile(basename(f)));
        const after = yield* textsOf(point, pages).pipe(Effect.mapError(gone));
        const before = previous
          ? yield* textsOf(previous, pages).pipe(Effect.mapError(gone))
          : {};
        const rootOf = (text: string | undefined) =>
          text === undefined
            ? Effect.succeed(null)
            : Effect.map(parseDocument(text), (parsed) =>
                "problem" in parsed ? null : parsed.root
              );
        return yield* Effect.forEach(pages, (file) =>
          Effect.gen(function* () {
            return {
              after: yield* rootOf(after[file]),
              before: yield* rootOf(before[file]),
              file,
            } satisfies PageChange;
          })
        );
      });

      const view = Effect.fn("History.view")(function* (id: string) {
        const point = yield* find(id);
        const texts = yield* textsOf(point).pipe(Effect.mapError(gone));
        const { tree: _tree, ...listedPoint } = point;
        return yield* pointViewOf(texts, {
          point: listedPoint,
          prefix: designsPrefix,
          rootName: humanise(basename(paths.designsDir)),
        });
      });

      return History.of({
        compare,
        get,
        rename,
        restore,
        save,
        turnEnded,
        turnStarted,
        view,
      });
    })
  );
}
