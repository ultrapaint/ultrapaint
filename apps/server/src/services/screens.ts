import type { ForbiddenPath } from "@ultrapaint/contracts/errors";
import { Conflict, NotFound } from "@ultrapaint/contracts/errors";
import {
  CanvasLayout,
  emptyCanvasLayout,
  type Screen,
} from "@ultrapaint/contracts/screens";
import { humanise } from "@ultrapaint/shared/path";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  Stream,
} from "effect";
import { makeWriteAtomic } from "../atomic-write.ts";
import { EventBus } from "../events.ts";
import { makeWalk } from "../fs-walk.ts";
import { hashContent, toPosix } from "../hash.ts";
import { RepoPaths } from "./repo-paths.ts";
import {
  componentName,
  renderTemplate,
  screenFileName,
  screenTemplates,
} from "./screen-templates.ts";

const IGNORED_DIRS = new Set(["node_modules", ".ultrapaint", "dist", ".vite"]);
const CANVAS_FILE = "canvas.json";
const TSX_EXT_RE = /\.tsx$/;
const NON_SCREEN_TSX_RE = /\.(stories|test|spec)\.tsx$/;
const SEGMENT_RE = /[\\/]/;

const decodeCanvas = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CanvasLayout)
);

const isScreenFile = (name: string) =>
  TSX_EXT_RE.test(name) &&
  !NON_SCREEN_TSX_RE.test(name) &&
  !name.startsWith("_");

type ScreensFailure = NotFound | Conflict | ForbiddenPath;

/** Discovers screens (TSX files) in the designs directory, watches them and owns `canvas.json`. */
export class ScreensService extends Context.Service<
  ScreensService,
  {
    readonly create: (
      flow: string,
      name: string,
      templateId?: string
    ) => Effect.Effect<Screen, ScreensFailure>;
    readonly delete: (id: string) => Effect.Effect<void, ScreensFailure>;
    readonly duplicate: (id: string) => Effect.Effect<Screen, ScreensFailure>;
    readonly list: Effect.Effect<Screen[]>;
    readonly readCanvas: (
      flow: string
    ) => Effect.Effect<CanvasLayout, Conflict>;
    readonly rename: (
      id: string,
      name: string
    ) => Effect.Effect<Screen, ScreensFailure>;
    readonly templates: typeof screenTemplates;
    readonly writeCanvas: (
      flow: string,
      layout: CanvasLayout
    ) => Effect.Effect<void, ForbiddenPath>;
  }
>()("ultrapaint/server/ScreensService") {
  static readonly layer = Layer.effect(
    ScreensService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      const walk = makeWalk(fs, path);
      const root = paths.designsDir;

      const exists = (p: string) =>
        Effect.orElseSucceed(fs.exists(p), () => false);

      const toScreen = (abs: string): Screen => {
        const id = toPosix(path.relative(root, abs));
        const flow = toPosix(path.dirname(id));
        return {
          file: paths.relative(abs),
          flow: flow === "." ? "" : flow,
          id,
          name: humanise(path.basename(abs)),
        };
      };

      const list = Effect.map(
        walk(root, {
          includeFile: isScreenFile,
          skipDir: (name) => IGNORED_DIRS.has(name) || name.startsWith("."),
        }),
        (files) => files.map(toScreen)
      ).pipe(Effect.withSpan("ScreensService.list"));

      const publishList = Effect.flatMap(list, (screens) =>
        events.publish("screens", { screens })
      );

      // ---- canvas layout ----
      const canvasPath = (flow: string) => path.join(root, flow, CANVAS_FILE);

      const readCanvas = Effect.fn("ScreensService.readCanvas")(function* (
        flow: string
      ) {
        const file = canvasPath(flow);
        if (!(yield* exists(file))) {
          return emptyCanvasLayout();
        }
        return yield* Effect.orDie(fs.readFileString(file)).pipe(
          Effect.flatMap(decodeCanvas),
          Effect.mapError(
            (error) =>
              new Conflict({
                message: `canvas.json in ${flow || "designs root"} is invalid: ${error.message}`,
              })
          )
        );
      });

      const writeCanvas = Effect.fn("ScreensService.writeCanvas")(function* (
        flow: string,
        layout: CanvasLayout
      ) {
        const file = yield* paths.resolve(canvasPath(flow));
        const sorted: CanvasLayout = {
          frames: Object.fromEntries(
            Object.entries(layout.frames).sort(([a], [b]) => a.localeCompare(b))
          ),
          version: 1,
        };
        yield* Effect.orDie(
          writeAtomic(file, `${JSON.stringify(sorted, null, 2)}\n`)
        );
      });

      /** Rewrites the frames of a flow; a missing source frame means there is nothing to do. */
      const updateFrames = Effect.fnUntraced(function* (
        flow: string,
        update: (
          frames: CanvasLayout["frames"]
        ) => CanvasLayout["frames"] | null
      ) {
        const layout = yield* readCanvas(flow);
        const frames = update(layout.frames);
        if (frames) {
          yield* writeCanvas(flow, { frames, version: 1 });
        }
      });

      // ---- lifecycle ----
      const byId = Effect.fnUntraced(function* (id: string) {
        const screen = (yield* list).find((s) => s.id === id);
        if (!screen) {
          return yield* new NotFound({ message: `screen not found: ${id}` });
        }
        const abs = yield* paths.resolve(path.join(root, screen.id));
        return { abs, screen };
      });

      const failIfExists = Effect.fnUntraced(function* (abs: string) {
        if (yield* exists(abs)) {
          return yield* new Conflict({
            message: `screen already exists: ${path.basename(abs)}`,
          });
        }
      });

      const create = Effect.fn("ScreensService.create")(function* (
        flow: string,
        name: string,
        templateId = "blank"
      ) {
        const fileName = screenFileName(name);
        const dir = yield* paths.resolve(path.join(root, flow));
        const abs = path.join(dir, fileName);
        yield* failIfExists(abs);
        yield* Effect.orDie(
          writeAtomic(abs, renderTemplate(templateId, componentName(fileName)))
        );
        yield* publishList;
        return { ...toScreen(abs), flow };
      });

      const rename = Effect.fn("ScreensService.rename")(function* (
        id: string,
        name: string
      ) {
        const { abs, screen } = yield* byId(id);
        const fileName = screenFileName(name);
        const target = path.join(path.dirname(abs), fileName);
        yield* failIfExists(target);
        yield* Effect.orDie(fs.rename(abs, target));
        const old = path.basename(screen.id);
        yield* updateFrames(screen.flow, (frames) => {
          const { [old]: frame, ...rest } = frames;
          return frame ? { ...rest, [fileName]: frame } : null;
        });
        yield* publishList;
        return toScreen(target);
      });

      const duplicate = Effect.fn("ScreensService.duplicate")(function* (
        id: string
      ) {
        const { abs, screen } = yield* byId(id);
        const base = path.basename(abs, ".tsx");
        let n = 2;
        let target = path.join(path.dirname(abs), `${base}-${n}.tsx`);
        while (yield* exists(target)) {
          n += 1;
          target = path.join(path.dirname(abs), `${base}-${n}.tsx`);
        }
        const source = yield* Effect.orDie(fs.readFileString(abs));
        const content = source.replace(
          new RegExp(
            `export default function ${componentName(path.basename(abs))}\\b`
          ),
          `export default function ${componentName(path.basename(target))}`
        );
        yield* Effect.orDie(writeAtomic(target, content));
        const from = path.basename(screen.id);
        yield* updateFrames(screen.flow, (frames) => {
          const frame = frames[from];
          return frame
            ? {
                ...frames,
                [path.basename(target)]: {
                  ...frame,
                  x: frame.x + frame.width + 80,
                },
              }
            : null;
        });
        yield* publishList;
        return toScreen(target);
      });

      const remove = Effect.fn("ScreensService.delete")(function* (id: string) {
        const { abs, screen } = yield* byId(id);
        yield* Effect.orDie(fs.remove(abs));
        const key = path.basename(screen.id);
        yield* updateFrames(screen.flow, (frames) => {
          const { [key]: removed, ...rest } = frames;
          return removed ? rest : null;
        });
        yield* publishList;
      });

      // ---- watching ----
      const lastHash = new Map<string, string>();

      const onCanvasChanged = Effect.fnUntraced(function* (abs: string) {
        const dir = toPosix(path.relative(root, path.dirname(abs)));
        const flow = dir === "." ? "" : dir;
        // An invalid canvas.json is reported when the editor asks for it, not from the watcher.
        const layout = yield* Effect.option(readCanvas(flow));
        if (layout._tag === "Some") {
          yield* events.publish("canvas", { flow, layout: layout.value });
        }
      });

      const onScreenChanged = Effect.fnUntraced(function* (abs: string) {
        // Give a non-atomic writer a moment to finish before hashing.
        yield* Effect.sleep("60 millis");
        const content = yield* Effect.option(fs.readFileString(abs));
        if (content._tag === "None") {
          lastHash.delete(abs);
          return;
        }
        const hash = hashContent(content.value);
        if (lastHash.get(abs) === hash) {
          return;
        }
        lastHash.set(abs, hash);
        yield* events.publish("file.changed", {
          file: paths.relative(abs),
          hash,
        });
      });

      const watched = fs.watch(root, { recursive: true }).pipe(
        Stream.filter(
          (event) =>
            !event.path.split(SEGMENT_RE).some((seg) => IGNORED_DIRS.has(seg))
        ),
        Stream.broadcast({ capacity: "unbounded", replay: 0 })
      );

      if (yield* exists(root)) {
        const stream = yield* watched;
        // Additions and removals, of files or whole flows, change the screen list.
        yield* stream.pipe(
          Stream.filter((event) => event._tag !== "Update"),
          Stream.debounce("80 millis"),
          Stream.runForEach(() => publishList),
          Effect.ignore({ log: true }),
          Effect.forkScoped
        );
        yield* stream.pipe(
          Stream.filter((event) => event._tag !== "Remove"),
          Stream.mapEffect(
            (event) => {
              const abs = path.resolve(root, event.path);
              const name = path.basename(abs);
              if (name === CANVAS_FILE) {
                return onCanvasChanged(abs);
              }
              return isScreenFile(name) ? onScreenChanged(abs) : Effect.void;
            },
            { concurrency: "unbounded" }
          ),
          Stream.runDrain,
          Effect.ignore({ log: true }),
          Effect.forkScoped
        );
      }

      return ScreensService.of({
        create,
        delete: remove,
        duplicate,
        list,
        readCanvas,
        rename,
        templates: screenTemplates,
        writeCanvas,
      });
    })
  );
}
