/**
 * The project's images (ADR 0107): the ones found where a favicon or an app icon is kept, which
 * Choose file offers and the default icon takes, and any image of the project, which the editor
 * draws from `GET /api/project-image?path=` (`ProjectImageRoute`) so a browser and the desktop
 * app's tabs need no file access of their own. With them, the project's icon as it is shown.
 */
import type { ShownProjectIcon } from "@ultrapaint/contracts/project";
import {
  PROJECT_ICON_COLORS,
  type Settings,
} from "@ultrapaint/contracts/settings";
import { folderName, initialsOf } from "@ultrapaint/shared/project-name";
import { Context, Effect, FileSystem, Layer, Path, Ref } from "effect";
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
    /** The file `rel` names, when it is an image inside the project; null otherwise. */
    readonly file: (rel: string) => Effect.Effect<string | null>;
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
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const paths = yield* RepoPaths;

      const file = Effect.fnUntraced(function* (rel: string) {
        if (!(rel && imageType(rel))) {
          return null;
        }
        // Outside the project, through `..` or a link, is refused: no image of it.
        const abs = yield* Effect.option(paths.resolve(rel));
        if (abs._tag === "None") {
          return null;
        }
        // A file that is not there, or can't be read, is no image either.
        const info = yield* Effect.option(fs.stat(abs.value));
        return info._tag === "Some" && info.value.type === "File"
          ? abs.value
          : null;
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
