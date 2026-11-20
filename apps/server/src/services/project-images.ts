/**
 * The project's images (ADR 0107): the ones found where a favicon or an app icon is kept, which
 * Choose file offers and the default icon takes, and any image of the project, which the editor
 * draws from `GET /api/project-image?path=` (`ProjectImageRoute`) so a browser and the desktop
 * app's tabs need no file access of their own. With them, the project's icon as it is shown.
 */

import { constants, promises as nodeFs } from "node:fs";
import type { ShownProjectIcon } from "@ultrapaint/contracts/project";
import {
  PROJECT_ICON_COLORS,
  type Settings,
} from "@ultrapaint/contracts/settings";
import { folderName, initialsOf } from "@ultrapaint/shared/project-name";
import { Context, Effect, Layer, Option, Path, Ref, Schema } from "effect";
import { toPosix } from "../hash.ts";
import { RepoPaths } from "./repo-paths.ts";

/** The images the editor draws, by their extension: what a design or an icon may show. */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

/** Where a web project keeps its favicon and app icons, from the application's folder. */
const ICON_DIRS = ["public", "app", "src/app", "src", "static", ""];

/** The names a favicon or an app icon goes by, the favicon's first: the default takes the first. */
const ICON_NAMES = [
  "favicon.svg",
  "favicon.png",
  "favicon.ico",
  "icon.svg",
  "icon.png",
  "app-icon.svg",
  "app-icon.png",
  "apple-touch-icon.png",
];

/** The content type of an image the editor draws, by the file's extension; none for any other file. */
export const imageType = (file: string): string | undefined =>
  IMAGE_TYPES[file.slice(file.lastIndexOf(".")).toLowerCase()];

/** The project's name: the one its settings give, else its folder's. */
export const projectName = (settings: Settings, root: string): string =>
  settings.name?.trim() || folderName(root);

/** A colour of the set taken from a name, the same for the same name everywhere. */
const colorOf = (name: string) => {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 2_147_483_647;
  }
  return PROJECT_ICON_COLORS[hash % PROJECT_ICON_COLORS.length] ?? "grey";
};

/** An image of the project that could not be opened or read: none is served. */
class ImageUnreadable extends Schema.TaggedError<ImageUnreadable>()(
  "ImageUnreadable",
  { message: Schema.String }
) {}

const unreadable = (error: unknown) =>
  new ImageUnreadable({
    message: error instanceof Error ? error.message : String(error),
  });

/**
 * Opens an image read-only, refusing a link as its last name and never waiting (a pipe in its
 * place opens at once, and is no regular file); closed with the scope.
 */
const openImage = (file: string) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      catch: unreadable,
      try: () =>
        nodeFs.open(
          file,
          // biome-ignore lint/suspicious/noBitwiseOperators: open(2)'s flags are bits, combined so.
          constants.O_RDONLY |
            (constants.O_NOFOLLOW ?? 0) |
            (constants.O_NONBLOCK ?? 0)
        ),
    }),
    (handle) =>
      Effect.tryPromise({ catch: unreadable, try: () => handle.close() }).pipe(
        // A handle that does not close leaks nothing the request still needs.
        Effect.ignore
      )
  );

/** The name's initials in a colour taken from the name: the icon when no image is found. */
const initialIcon = (name: string): ShownProjectIcon => ({
  color: colorOf(name),
  initial: initialsOf(name),
  kind: "initial",
});

/**
 * The open project's images. What is found where favicons are kept is looked for when the project
 * opens and again each time it is asked for (`found`) or the settings are put in force
 * (`refresh`): nothing watches those folders, which are the code's, not the designs'.
 */
export class ProjectImages extends Context.Service<
  ProjectImages,
  {
    /**
     * What the file `rel` names holds, when it is an image inside the project; null otherwise.
     * Read through one handle, and checked once it is open: a link swapped in along the way
     * reads nothing from outside the project.
     */
    readonly file: (rel: string) => Effect.Effect<Uint8Array | null>;
    /**
     * The images found where a favicon or an app icon is kept, in the application's folder
     * first, then the project's: each by its path from the project's folder, the favicons first.
     * Looked for now, and kept for the default icon.
     */
    readonly found: Effect.Effect<readonly string[]>;
    /** Looks for the images again, for the default icon. */
    readonly refresh: Effect.Effect<void>;
    /**
     * The icon shown for the project with these settings and this name: the one they give, when
     * its file is still there; else the first image found, else the name's initials in a colour.
     */
    readonly shown: (
      settings: Settings,
      name: string
    ) => Effect.Effect<ShownProjectIcon>;
  }
>()("ultrapaint/server/ProjectImages") {
  static readonly layer = Layer.effect(
    ProjectImages,
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const paths = yield* RepoPaths;

      /**
       * Whether the file opened is inside the project. Where the system names an open file
       * (`/proc/self/fd` on Linux), that name; elsewhere the name it was opened by, not
       * followed, must still be that very file (its device and inode), every folder on the way
       * a folder and no link.
       */
      const insideProject = Effect.fnUntraced(function* (
        fd: number,
        opened: string,
        info: { readonly dev: number; readonly ino: number }
      ) {
        const named = yield* Effect.option(
          Effect.tryPromise({
            catch: unreadable,
            try: () => nodeFs.readlink(`/proc/self/fd/${fd}`),
          })
        );
        if (Option.isSome(named)) {
          return Option.isSome(
            yield* Effect.option(paths.resolve(named.value))
          );
        }
        const leaf = yield* Effect.tryPromise({
          catch: unreadable,
          try: () => nodeFs.lstat(opened),
        });
        if (
          !(leaf.isFile() && leaf.dev === info.dev && leaf.ino === info.ino)
        ) {
          return false;
        }
        // The name is canonical up to its leaf (`RepoPaths.resolve`): none of the folders on the
        // way may be a link now, as one swapped in for a folder would have led the open outside.
        // Without a handle-relative open, a swap there and back between the open and this look
        // is the gap left, on a system that cannot name an open file.
        const folders: string[] = [];
        for (let dir = path.dirname(opened); ; dir = path.dirname(dir)) {
          folders.push(dir);
          if (path.dirname(dir) === dir) {
            break;
          }
        }
        const links = yield* Effect.forEach(folders, (dir) =>
          Effect.tryPromise({
            catch: unreadable,
            try: () => nodeFs.lstat(dir),
          }).pipe(Effect.map((stat) => !stat.isDirectory()))
        );
        return !links.some(Boolean);
      });

      const file = Effect.fnUntraced(function* (rel: string) {
        if (!(rel && imageType(rel))) {
          return null;
        }
        // Outside the project, through `..` or a link, is refused: no image of it.
        const abs = yield* Effect.option(paths.resolve(rel));
        if (abs._tag === "None") {
          return null;
        }
        // Everything after is asked of the file opened, never of its name again.
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* openImage(abs.value);
            const opened = yield* Effect.tryPromise({
              catch: unreadable,
              try: () => handle.stat(),
            });
            if (!opened.isFile()) {
              return null;
            }
            const bytes = yield* Effect.tryPromise({
              catch: unreadable,
              try: () => handle.readFile(),
            });
            // Changed while it was read: not the image it was.
            if (bytes.byteLength !== opened.size) {
              return null;
            }
            return (yield* insideProject(handle.fd, abs.value, opened))
              ? new Uint8Array(bytes)
              : null;
          })
        ).pipe(
          // A file that is not there, can't be read, or leads out meanwhile is no image either.
          Effect.orElseSucceed(() => null)
        );
      });

      const bases = [
        ...new Set([
          ...(paths.settings.resolveFrom ? [paths.settings.resolveFrom] : []),
          "",
        ]),
      ];
      const candidates = [
        ...new Set(
          ICON_NAMES.flatMap((name) =>
            bases.flatMap((base) =>
              ICON_DIRS.map((dir) => toPosix(path.join(base, dir, name)))
            )
          )
        ),
      ];
      const lookFor = Effect.map(
        Effect.forEach(
          candidates,
          (rel) => Effect.map(file(rel), (abs) => (abs ? rel : null)),
          { concurrency: 16 }
        ),
        (present) => present.filter((rel) => rel !== null)
      );

      const kept = yield* Ref.make<readonly string[]>(yield* lookFor);
      const found = Effect.tap(lookFor, (images) => Ref.set(kept, images));

      const shown = Effect.fn("ProjectImages.shown")(function* (
        settings: Settings,
        name: string
      ) {
        const { icon } = settings;
        if (icon?.kind === "icon") {
          return icon;
        }
        if (icon?.kind === "file" && (yield* file(icon.path))) {
          return icon;
        }
        const [first] = yield* Ref.get(kept);
        return first
          ? ({ kind: "file", path: first } as const)
          : initialIcon(name);
      });

      return ProjectImages.of({
        file,
        found,
        refresh: Effect.asVoid(found),
        shown,
      });
    })
  );
}
