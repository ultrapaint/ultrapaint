/**
 * What changed in the designs, whoever changed it: the edit journal's writes (an edit, an undo, an
 * action), and everyone else's (an agent, a checkout, another editor), which one recursive watch
 * of the designs directory sees. Each file is classified once, by what it is (a page, a canvas, a
 * component, the design system's files, a skill, the link to the code, a canvas's comments), and a
 * change is told once per content: the watcher's echo of a write the journal told of is no change.
 * Modules subscribe to the kinds they own; the editors' `file.changed` is told of every change too.
 *
 * A change is told with who it was written for, as far as the server knows (`Writer`): a thread's
 * agent, the editor's user, or nobody known, which is what the watcher sees. What a thread's turn
 * changed is told apart from what others changed meanwhile by it (`turn-witness.ts`).
 *
 * Two adapters: the live one watches the directory, the in-memory one only hears what it is told
 * (`report`), so a test tells it of a file written by hand instead of waiting for a watcher.
 */
import {
  COMPONENT_EXTENSION,
  COMPONENTS_DIR,
} from "@ultrapaint/contracts/component-names";
import {
  DESIGN_NOTES_FILE,
  DESIGN_SYSTEM_FILE,
} from "@ultrapaint/contracts/design-system";
import { IMPLEMENTATION_FILE } from "@ultrapaint/contracts/implementation";
import { SKILL_EXTENSION, SKILLS_DIR } from "@ultrapaint/contracts/skills";
import { isPageFile } from "@ultrapaint/design-document/tree";
import { CANVAS_FILE, CANVASES_FILE } from "@ultrapaint/shared/canvas";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  PubSub,
  type Scope,
  Stream,
} from "effect";
import { EventBus } from "../events.ts";
import { hashContent, toPosix } from "../hash.ts";
import { COMMENTS_FILE } from "./comments-file.ts";
import { DESIGN_TOKENS_FILE } from "./dtcg.ts";
import { IGNORED_DIRS } from "./pages-layout.ts";
import { RepoPaths } from "./repo-paths.ts";

/** What a file of the designs is, as the modules that own each kind know it. */
export type DesignKind =
  | "canvas"
  | "canvases"
  | "comments"
  | "component"
  | "designSystem"
  | "implementation"
  | "notes"
  | "page"
  | "skill"
  | "tokens";

/** A file of the designs changed: its repository-relative path, and its content's hash ("" gone). */
export interface DesignChange {
  readonly file: string;
  readonly hash: string;
  readonly kind: DesignKind;
}

/** Who a file was written for, as far as the server knows. */
export type Writer =
  /** A thread's agent, through the editor: a file it asked the editor to write, an MCP tool. */
  | { readonly _tag: "Thread"; readonly threadId: string }
  /** The editor's user, or an agent from outside the editor, through the editor's requests. */
  | { readonly _tag: "Editor" }
  /** Nobody known: what the watcher saw (an agent's shell, a checkout), a file written by hand. */
  | { readonly _tag: "Unknown" };

/** A file the server was told changed, any file, and who it was written for. */
export interface FileWrite {
  readonly by: Writer;
  readonly file: string;
}

const UNKNOWN: Writer = { _tag: "Unknown" };

const SEGMENT_RE = /[\\/]/;

/** What a file inside the designs directory is, by its path there; null when it is none of them. */
export const kindOf = (rel: string): DesignKind | null => {
  const segments = toPosix(rel).split("/");
  if (segments.some((s) => IGNORED_DIRS.has(s))) {
    return null;
  }
  const name = segments.at(-1) ?? "";
  const atRoot = segments.length === 1;
  const inDir = (dir: string) => segments.length === 2 && segments[0] === dir;
  if (isPageFile(name)) {
    return "page";
  }
  if (name === CANVAS_FILE) {
    return "canvas";
  }
  if (name === COMMENTS_FILE) {
    return "comments";
  }
  if (inDir(COMPONENTS_DIR) && name.endsWith(COMPONENT_EXTENSION)) {
    return "component";
  }
  if (inDir(SKILLS_DIR) && name.endsWith(SKILL_EXTENSION)) {
    return "skill";
  }
  const atTheRoot: Readonly<Record<string, DesignKind>> = {
    [CANVASES_FILE]: "canvases",
    [DESIGN_NOTES_FILE]: "notes",
    [DESIGN_SYSTEM_FILE]: "designSystem",
    [DESIGN_TOKENS_FILE]: "tokens",
    [IMPLEMENTATION_FILE]: "implementation",
  };
  return atRoot ? (atTheRoot[name] ?? null) : null;
};

export class DesignFiles extends Context.Service<
  DesignFiles,
  {
    /** The changes of these kinds, from now on, each once per content. */
    readonly changes: (
      kinds: readonly DesignKind[]
    ) => Stream.Stream<DesignChange>;
    /**
     * What came and went under the designs directory, as the watcher saw it (a file or a
     * directory added, renamed or removed), for what a listing of the files may change. The
     * in-memory adapter sees nothing come or go.
     */
    readonly comings: Stream.Stream<FileSystem.WatchEvent>;
    /**
     * Tells of a file as it is now, `null` for one that is gone, and who it was written for
     * (nobody known unless said): the journal of its writes, the editor of a file it wrote for
     * an agent, the watcher of everyone else's, a test of a file written by hand. Content it was
     * last told of is no change. Any file told of reaches the editors' `file.changed` and
     * `writes`; a file of the designs reaches the modules that subscribe to its kind.
     */
    readonly report: (
      file: string,
      content: string | null,
      by?: Writer
    ) => Effect.Effect<void>;
    /**
     * Keeps, for as long as the scope, every file told of from now on, of the designs or not,
     * once per content, with who it was written for. What it gives answers the files told of
     * since it was last asked, without waiting: whatever was told before it is asked is there.
     */
    readonly writes: Effect.Effect<
      Effect.Effect<readonly FileWrite[]>,
      never,
      Scope.Scope
    >;
  }
>()("ultrapaint/server/DesignFiles") {
  /** The changes the journal and a test tell of, and nothing else. */
  static readonly layerTest = Layer.effect(
    DesignFiles,
    Effect.map(
      Effect.suspend(() => makeDesignFiles),
      ({ service }) => service
    )
  );

  /** The changes the journal tells of, and the ones a recursive watch of the designs sees. */
  static readonly layer = Layer.effect(
    DesignFiles,
    Effect.gen(function* () {
      const { comings, service } = yield* makeDesignFiles;
      const paths = yield* RepoPaths;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = paths.designsDir;
      if (!(yield* fs.exists(root).pipe(Effect.orElseSucceed(() => false)))) {
        return service;
      }

      /** A file written by someone else: an agent, a checkout, an editor. */
      const seen = Effect.fnUntraced(function* (abs: string) {
        // Give a non-atomic writer a moment to finish before reading.
        yield* Effect.sleep("60 millis");
        const content = yield* Effect.option(fs.readFileString(abs));
        yield* service.report(
          paths.relative(abs),
          content._tag === "None" ? null : content.value
        );
      });

      yield* fs.watch(root, { recursive: true }).pipe(
        Stream.filter(
          (event) =>
            !event.path.split(SEGMENT_RE).some((seg) => IGNORED_DIRS.has(seg))
        ),
        Stream.mapEffect(
          (event) =>
            Effect.gen(function* () {
              if (event._tag !== "Update") {
                yield* PubSub.publish(comings, event);
              }
              if (kindOf(event.path) !== null) {
                // A file that vanished or cannot be read mid-way is logged, and the watch goes
                // on to the next change.
                yield* seen(path.resolve(root, event.path)).pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning(
                      "a change to the designs was not handled",
                      cause
                    )
                  )
                );
              }
            }),
          { concurrency: "unbounded" }
        ),
        Stream.runDrain,
        Effect.ignore({ log: true }),
        Effect.forkScoped
      );
      return service;
    })
  );
}

/** The adapters' common part: what is told, deduplicated, classified and published. */
const makeDesignFiles = Effect.gen(function* () {
  const paths = yield* RepoPaths;
  const events = yield* EventBus;
  const path = yield* Path.Path;
  const changed = yield* Effect.acquireRelease(
    PubSub.unbounded<DesignChange>(),
    PubSub.shutdown
  );
  const comings = yield* Effect.acquireRelease(
    PubSub.unbounded<FileSystem.WatchEvent>(),
    PubSub.shutdown
  );
  const written = yield* Effect.acquireRelease(
    PubSub.unbounded<FileWrite>(),
    PubSub.shutdown
  );
  /** Each file's content as it was last told of, by its hash. */
  const last = new Map<string, string>();

  /** What a repository-relative file is in the designs; DESIGN.md at the root is the notes too. */
  const classify = (file: string): DesignKind | null => {
    const abs = path.resolve(paths.root, file);
    const rel = toPosix(path.relative(paths.designsDir, abs));
    if (!rel.startsWith("..")) {
      return kindOf(rel);
    }
    return path.dirname(abs) === paths.root &&
      path.basename(abs) === DESIGN_NOTES_FILE
      ? "notes"
      : null;
  };

  const report = Effect.fn("DesignFiles.report")(function* (
    file: string,
    content: string | null,
    by: Writer = UNKNOWN
  ) {
    const hash = content === null ? "" : hashContent(content);
    if (last.get(file) === hash) {
      return;
    }
    // A file gone is forgotten: page files come and go with every rename and delete.
    if (hash === "") {
      last.delete(file);
    } else {
      last.set(file, hash);
    }
    const kind = classify(file);
    yield* events.publish("file.changed", { file, hash });
    yield* PubSub.publish(written, { by, file });
    if (kind !== null) {
      yield* PubSub.publish(changed, { file, hash, kind });
    }
  });

  const service = DesignFiles.of({
    changes: (kinds) =>
      Stream.filter(Stream.fromPubSub(changed), (c) => kinds.includes(c.kind)),
    comings: Stream.fromPubSub(comings),
    report,
    writes: Effect.map(PubSub.subscribe(written), (subscription) =>
      Effect.suspend(() =>
        // The project closed: nothing more is told.
        PubSub.isShutdownUnsafe(written)
          ? Effect.succeed([])
          : PubSub.takeUpTo(subscription, Number.POSITIVE_INFINITY)
      )
    ),
  });
  return { comings, service };
});
