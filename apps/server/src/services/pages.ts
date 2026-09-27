import {
  DESIGN_NOTES_FILE,
  DESIGN_SYSTEM_FILE,
} from "@ultrapaint/contracts/design-system";
import { BadRequest, Conflict, NotFound } from "@ultrapaint/contracts/errors";
import {
  CanvasLayout,
  emptyCanvasLayout,
  emptySpaceConfig,
  type FrameLayout,
  type Page,
  type PageList,
  type Space,
  SpaceConfig,
} from "@ultrapaint/contracts/pages";
import { SKILL_EXTENSION, SKILLS_DIR } from "@ultrapaint/contracts/skills";
import {
  pageTemplates,
  renderTemplate,
  serialise,
} from "@ultrapaint/design-document/factories";
import { fillIds } from "@ultrapaint/design-document/ids";
import { isPageFile, PAGE_EXTENSION } from "@ultrapaint/design-document/tree";
import { basename, humanise } from "@ultrapaint/shared/path";
import {
  normaliseRoute,
  pagePathOf,
  routeLabel,
  routeOf,
} from "@ultrapaint/shared/route";
import {
  pathInSpace,
  ROOT_SPACE,
  SPACE_FILE,
  spaceIdOf,
  spaceIdsFrom,
} from "@ultrapaint/shared/space";
import {
  Context,
  Effect,
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
import { type EditFailure, EditService, type EditTransaction } from "./edit.ts";
import { RepoPaths } from "./repo-paths.ts";

const IGNORED_DIRS = new Set(["node_modules", ".ultrapaint", "dist", ".vite"]);
export const CANVAS_FILE = "canvas.json";
const SEGMENT_RE = /[\\/]/;
const UNSAFE_NAME_RE = /[^A-Za-z0-9-_]+/g;
const EDGE_DASHES_RE = /^-+|-+$/g;

const decodeCanvas = Schema.decodeUnknownEffect(CanvasLayout);
const decodeSpace = Schema.decodeUnknownEffect(
  Schema.fromJsonString(SpaceConfig)
);

/**
 * A layout from the text of `canvas.json`, with the ids its nodes leave out filled in. Nodes
 * are the canvas's document; ids are what an operation names them by.
 */
export const parseCanvas = (text: string) =>
  Effect.gen(function* () {
    const json = yield* Effect.try({
      catch: (error) =>
        new Conflict({ message: `canvas.json is not JSON: ${String(error)}` }),
      try: () => JSON.parse(text) as unknown,
    });
    const filled = fillIds(json);
    const layout = yield* decodeCanvas(json).pipe(
      Effect.mapError(
        (error) =>
          new Conflict({ message: `canvas.json is invalid: ${error.message}` })
      )
    );
    return { filled, layout };
  });

/** A name made safe for a file: `Sign in` becomes `sign-in`. */
export const slugOf = (name: string) =>
  name
    .trim()
    .replaceAll(UNSAFE_NAME_RE, "-")
    .replaceAll(EDGE_DASHES_RE, "")
    .toLowerCase() || "page";

/** `canvas.json` as it is written: keys sorted, and no empty node list. */
export const renderCanvas = (layout: CanvasLayout) => {
  const frames = Object.fromEntries(
    Object.entries(layout.frames).sort(([a], [b]) => a.localeCompare(b))
  );
  const nodes = layout.nodes ?? [];
  return serialise({
    frames,
    ...(nodes.length > 0 && { nodes }),
    version: 1,
  });
};

type PagesFailure = EditFailure;

/**
 * The pages of the designs directory, grouped into the spaces that own them. A space is a
 * directory with a `space.json`; while there is none the designs directory is itself the one
 * space. A page is a `<route>.page.json` design document. Owns `canvas.json` and watches
 * everything for the editor.
 */
export class PagesService extends Context.Service<
  PagesService,
  {
    readonly create: (
      space: string,
      route: string,
      templateId?: string
    ) => Effect.Effect<Page, PagesFailure>;
    readonly createSpace: (name: string) => Effect.Effect<Space, PagesFailure>;
    readonly delete: (id: string) => Effect.Effect<void, PagesFailure>;
    readonly duplicate: (id: string) => Effect.Effect<Page, PagesFailure>;
    readonly list: Effect.Effect<PageList>;
    /** The layout of a space: its frames and the nodes on its canvas. */
    readonly readCanvas: (
      space: string
    ) => Effect.Effect<CanvasLayout, Conflict>;
    /** Repo-relative path of a space's `canvas.json`. */
    readonly canvasFile: (space: string) => Effect.Effect<string, EditFailure>;
    /** Moves the page to the route it should serve from now on. */
    readonly rename: (
      id: string,
      route: string
    ) => Effect.Effect<Page, PagesFailure>;
    readonly templates: readonly {
      readonly id: string;
      readonly name: string;
    }[];
    /** Changes the layout inside an action, which the change becomes part of. */
    readonly updateCanvas: (
      tx: EditTransaction,
      space: string,
      update: (layout: CanvasLayout) => CanvasLayout
    ) => Effect.Effect<void, PagesFailure | Conflict>;
    /** Saves where the frames are as the editor has them: one undo step when anything moved. */
    readonly writeFrames: (
      space: string,
      frames: Record<string, FrameLayout>
    ) => Effect.Effect<void, PagesFailure>;
  }
>()("ultrapaint/server/PagesService") {
  static readonly layer = Layer.effect(
    PagesService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const edit = yield* EditService;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const walk = makeWalk(fs, path);
      const root = paths.designsDir;
      // Renames, duplicates and deletes pick a file name and rewrite `canvas.json`; two at
      // once would choose the same name or lose each other's frame.
      const mutations = yield* Semaphore.make(1);
      const exclusive = mutations.withPermits(1);

      const exists = (p: string) =>
        Effect.orElseSucceed(fs.exists(p), () => false);

      const relativeToDesigns = (abs: string) =>
        toPosix(path.relative(root, abs));

      // ---- spaces and pages ----
      const found = walk(root, {
        includeFile: (name) => name === SPACE_FILE || isPageFile(name),
        skipDir: (name) =>
          IGNORED_DIRS.has(name) ||
          name.startsWith(".") ||
          name.startsWith("_"),
      });

      const readSpace = Effect.fnUntraced(function* (id: string) {
        const fallback: Space = {
          home: "/",
          id,
          name: id === ROOT_SPACE ? humanise(basename(root)) : humanise(id),
        };
        const file = path.join(root, id, SPACE_FILE);
        if (!(yield* exists(file))) {
          return fallback;
        }
        const config = yield* Effect.orElseSucceed(
          Effect.flatMap(Effect.orDie(fs.readFileString(file)), (content) =>
            decodeSpace(content)
          ),
          (): SpaceConfig => ({ version: 1 })
        );
        return {
          home: normaliseRoute(config.home ?? "/"),
          id,
          name: config.name ?? fallback.name,
        } satisfies Space;
      });

      const toPage = (space: string, pagePath: string, abs: string): Page => {
        const route = routeOf(pagePath);
        return {
          file: paths.relative(abs),
          id: relativeToDesigns(abs),
          name: routeLabel(route),
          path: pagePath,
          route,
          space,
        };
      };

      const list: Effect.Effect<PageList> = Effect.gen(function* () {
        const files = yield* found;
        const spaceIds = spaceIdsFrom(
          files
            .filter((abs) => path.basename(abs) === SPACE_FILE)
            .map(relativeToDesigns)
        );
        const spaces = yield* Effect.forEach(
          spaceIds.length === 0 ? [ROOT_SPACE] : spaceIds,
          readSpace
        );
        const pages: Page[] = [];
        for (const abs of files) {
          if (!isPageFile(path.basename(abs))) {
            continue;
          }
          const id = relativeToDesigns(abs);
          const space = spaceIdOf(spaceIds, id);
          // A page file that no space holds is not a page: it sits beside the spaces.
          if (space !== null) {
            pages.push(toPage(space, pathInSpace(space, id), abs));
          }
        }
        return { pages, spaces };
      }).pipe(Effect.withSpan("PagesService.list"));

      const publishList = Effect.flatMap(list, (pageList) =>
        events.publish("pages", pageList)
      );

      // ---- canvas layout ----
      const canvasPath = (space: string) => path.join(root, space, CANVAS_FILE);

      const readCanvas = Effect.fn("PagesService.readCanvas")(function* (
        space: string
      ) {
        const file = canvasPath(space);
        if (!(yield* exists(file))) {
          return emptyCanvasLayout();
        }
        const text = yield* Effect.orDie(fs.readFileString(file));
        const { layout } = yield* parseCanvas(text).pipe(
          Effect.mapError(
            (error) =>
              new Conflict({
                message: `${error.message} (in ${space || "the designs root"})`,
              })
          )
        );
        return layout;
      });

      const canvasFile = Effect.fnUntraced(function* (space: string) {
        return paths.relative(yield* paths.resolve(canvasPath(space)));
      });

      const updateCanvas = Effect.fnUntraced(function* (
        tx: EditTransaction,
        space: string,
        update: (layout: CanvasLayout) => CanvasLayout
      ) {
        const layout = yield* readCanvas(space);
        yield* tx.write(yield* canvasFile(space), renderCanvas(update(layout)));
      });

      const writeFrames = Effect.fn("PagesService.writeFrames")(function* (
        space: string,
        frames: Record<string, FrameLayout>
      ) {
        yield* edit.transaction("Arrange the canvas", (tx) =>
          updateCanvas(tx, space, (layout) => ({ ...layout, frames }))
        );
      });

      /** Rewrites the frames of a space; a missing source frame means there is nothing to do. */
      const updateFrames = Effect.fnUntraced(function* (
        tx: EditTransaction,
        space: string,
        update: (
          frames: CanvasLayout["frames"]
        ) => CanvasLayout["frames"] | null
      ) {
        const layout = yield* readCanvas(space);
        const frames = update(layout.frames);
        if (frames) {
          yield* tx.write(
            yield* canvasFile(space),
            renderCanvas({ ...layout, frames })
          );
        }
      });

      // ---- lifecycle ----
      const byId = Effect.fnUntraced(function* (id: string) {
        const page = (yield* list).pages.find((p) => p.id === id);
        if (!page) {
          return yield* new NotFound({ message: `page not found: ${id}` });
        }
        const abs = yield* paths.resolve(path.join(root, page.id));
        return { abs, page };
      });

      const failIfExists = Effect.fnUntraced(function* (abs: string) {
        if (yield* exists(abs)) {
          return yield* new Conflict({
            message: `a page already serves that route: ${path.basename(abs)}`,
          });
        }
      });

      /** The file a route is served from, with every segment made safe as a file name. */
      const fileForRoute = Effect.fnUntraced(function* (route: string) {
        const normalised = normaliseRoute(route);
        const segments = pagePathOf(normalised)
          .split("/")
          .map((segment) =>
            // `[id]` keeps its brackets; anything else is slugged the way a name is.
            segment.startsWith("[") ? segment : slugOf(segment)
          );
        if (segments.some((segment) => segment === "")) {
          return yield* new BadRequest({ message: `invalid route: ${route}` });
        }
        return {
          path: `${segments.join("/")}${PAGE_EXTENSION}`,
          route: normalised,
        };
      });

      const create = Effect.fn("PagesService.create")(function* (
        space: string,
        route: string,
        templateId = "blank"
      ) {
        const target = yield* fileForRoute(route);
        const abs = yield* paths.resolve(path.join(root, space, target.path));
        yield* failIfExists(abs);
        const document = renderTemplate(templateId, routeLabel(target.route));
        yield* edit.transaction(`Create ${target.route}`, (tx) =>
          tx.create(paths.relative(abs), serialise(document))
        );
        yield* publishList;
        return toPage(space, target.path, abs);
      });

      const createSpace = Effect.fn("PagesService.createSpace")(function* (
        name: string
      ) {
        const id = slugOf(name);
        const dir = yield* paths.resolve(path.join(root, id));
        if (yield* exists(path.join(dir, SPACE_FILE))) {
          return yield* new Conflict({
            message: `space already exists: ${id}`,
          });
        }
        const { pages, spaces } = yield* list;
        // The first explicit space would otherwise orphan the pages of the implicit root one.
        const rootIsImplicit =
          spaces.length === 1 && (spaces[0] as Space).id === ROOT_SPACE;
        const config = (spaceName: string) =>
          serialise(emptySpaceConfig(spaceName));
        yield* edit.transaction(`Create space ${name}`, (tx) =>
          Effect.gen(function* () {
            if (rootIsImplicit && pages.length > 0) {
              yield* tx.write(
                paths.relative(path.join(root, SPACE_FILE)),
                config((spaces[0] as Space).name)
              );
            }
            yield* tx.create(
              paths.relative(path.join(dir, SPACE_FILE)),
              config(name)
            );
          })
        );
        yield* publishList;
        return { home: "/", id, name } satisfies Space;
      });

      const rename = Effect.fn("PagesService.rename")(function* (
        id: string,
        route: string
      ) {
        const { abs, page } = yield* byId(id);
        const target = yield* fileForRoute(route);
        if (target.path === page.path) {
          return page;
        }
        const to = yield* paths.resolve(
          path.join(root, page.space, target.path)
        );
        yield* failIfExists(to);
        const content = yield* Effect.orDie(fs.readFileString(abs));
        // A move is the old file gone and the new one there, which is also how it is undone.
        yield* edit.transaction(`Move ${page.route} to ${target.route}`, (tx) =>
          Effect.gen(function* () {
            yield* tx.create(paths.relative(to), content);
            yield* tx.remove(paths.relative(abs));
            yield* updateFrames(tx, page.space, (frames) => {
              const { [page.path]: frame, ...rest } = frames;
              return frame ? { ...rest, [target.path]: frame } : null;
            });
          })
        );
        yield* publishList;
        return toPage(page.space, target.path, to);
      });

      const duplicate = Effect.fn("PagesService.duplicate")(function* (
        id: string
      ) {
        const { abs, page } = yield* byId(id);
        const base = path.basename(abs, PAGE_EXTENSION);
        let n = 2;
        const named = (i: number) =>
          path.join(path.dirname(abs), `${base}-${i}${PAGE_EXTENSION}`);
        let target = named(n);
        while (yield* exists(target)) {
          n += 1;
          target = named(n);
        }
        // Ids are unique within a document; a copy in a file of its own keeps them.
        const content = yield* Effect.orDie(fs.readFileString(abs));
        const copyPath = pathInSpace(page.space, relativeToDesigns(target));
        yield* edit.transaction(`Duplicate ${page.route}`, (tx) =>
          Effect.gen(function* () {
            yield* tx.create(paths.relative(target), content);
            yield* updateFrames(tx, page.space, (frames) => {
              const frame = frames[page.path];
              return frame
                ? {
                    ...frames,
                    [copyPath]: { ...frame, x: frame.x + frame.width + 80 },
                  }
                : null;
            });
          })
        );
        yield* publishList;
        return toPage(page.space, copyPath, target);
      });

      const remove = Effect.fn("PagesService.delete")(function* (id: string) {
        const { abs, page } = yield* byId(id);
        yield* edit.transaction(`Delete ${page.route}`, (tx) =>
          Effect.gen(function* () {
            yield* tx.remove(paths.relative(abs));
            yield* updateFrames(tx, page.space, (frames) => {
              const { [page.path]: removed, ...rest } = frames;
              return removed ? rest : null;
            });
          })
        );
        yield* publishList;
      });

      // ---- watching ----
      const lastHash = new Map<string, string>();

      const onCanvasChanged = Effect.fnUntraced(function* (abs: string) {
        const dir = relativeToDesigns(path.dirname(abs));
        const space = dir === "." ? ROOT_SPACE : dir;
        // An invalid or vanished canvas.json is reported when the editor asks for it. Here it
        // must not end the watcher, so defects are caught along with failures.
        const layout = yield* Effect.exit(readCanvas(space));
        if (layout._tag === "Success") {
          yield* events.publish("canvas", { layout: layout.value, space });
        }
      });

      /** A document written by someone else: an agent, a checkout, an editor. */
      const onFileChanged = Effect.fnUntraced(function* (abs: string) {
        // Give a non-atomic writer a moment to finish before hashing.
        yield* Effect.sleep("60 millis");
        const content = yield* Effect.option(fs.readFileString(abs));
        const hash = content._tag === "None" ? "" : hashContent(content.value);
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
        // Additions and removals, of pages or whole spaces, change the page list.
        yield* stream.pipe(
          Stream.filter((event) => event._tag !== "Update"),
          Stream.debounce("80 millis"),
          Stream.runForEach(() => publishList),
          Effect.ignore({ log: true }),
          Effect.forkScoped
        );
        yield* stream.pipe(
          Stream.mapEffect(
            (event) => {
              const abs = path.resolve(root, event.path);
              const name = path.basename(abs);
              if (name === CANVAS_FILE) {
                return Effect.andThen(onCanvasChanged(abs), onFileChanged(abs));
              }
              if (name === SPACE_FILE) {
                return publishList;
              }
              const watchedFile =
                isPageFile(name) ||
                (path.dirname(abs) === root &&
                  (name === DESIGN_SYSTEM_FILE ||
                    name === DESIGN_NOTES_FILE)) ||
                (path.dirname(abs) === path.join(root, SKILLS_DIR) &&
                  name.endsWith(SKILL_EXTENSION));
              return watchedFile ? onFileChanged(abs) : Effect.void;
            },
            { concurrency: "unbounded" }
          ),
          Stream.runDrain,
          Effect.ignore({ log: true }),
          Effect.forkScoped
        );
      }

      return PagesService.of({
        canvasFile,
        create: (space, route, templateId) =>
          exclusive(create(space, route, templateId)),
        createSpace: (name) => exclusive(createSpace(name)),
        delete: (id) => exclusive(remove(id)),
        duplicate: (id) => exclusive(duplicate(id)),
        list,
        readCanvas,
        rename: (id, route) => exclusive(rename(id, route)),
        templates: pageTemplates,
        updateCanvas,
        writeFrames: (space, frames) => exclusive(writeFrames(space, frames)),
      });
    })
  );
}
