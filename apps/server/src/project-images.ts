/**
 * The project's name and icon as they are shown (ADR 0107), and the images of the project an icon
 * may be: the ones found where a favicon or an app icon is kept, which Choose file offers and the
 * default icon takes, and any image of the project, served to the editor at
 * `GET /api/project-image?path=` so a browser and the desktop app's tabs draw it with no file
 * access of their own (`ProjectImageRoute`).
 */
import type { ShownProjectIcon } from "@ultrapaint/contracts/project";
import {
  PROJECT_ICON_COLORS,
  type Settings,
} from "@ultrapaint/contracts/settings";
import type { FileSystem, Path } from "effect";
import { Effect } from "effect";
import { toPosix } from "./hash.ts";
import { RepoPaths } from "./services/repo-paths.ts";

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

const SEPARATOR_RE = /[\\/]/;

/** The project's name: the one its settings give, else its folder's. */
export const projectName = (settings: Settings, root: string): string =>
  settings.name?.trim() ||
  root.split(SEPARATOR_RE).filter(Boolean).at(-1) ||
  root;

const LETTER_RE = /[\p{L}\p{N}]/u;

/** A colour of the set taken from a name, the same for the same name everywhere. */
const colourOf = (name: string) => {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 2_147_483_647;
  }
  return PROJECT_ICON_COLORS[hash % PROJECT_ICON_COLORS.length] ?? "grey";
};

/** The name's initial in a colour taken from the name: the icon when no image is found. */
const initialOf = (name: string): ShownProjectIcon => ({
  color: colourOf(name),
  initial: (name.match(LETTER_RE)?.[0] ?? name.trim()[0] ?? "?")
    .toLocaleUpperCase()
    .slice(0, 2),
  kind: "initial",
});

/** What the project's images are read with: the file system the server was given. */
export const makeProjectImages = (
  fs: FileSystem.FileSystem,
  path: Path.Path
) => {
  /** The file `rel` names, when it is an image inside the project; null otherwise. */
  const file = Effect.fnUntraced(function* (rel: string) {
    if (!(rel && imageType(rel))) {
      return null;
    }
    const paths = yield* RepoPaths;
    // Outside the project, through `..` or a link, is refused.
    const abs = yield* Effect.option(paths.resolve(rel));
    if (abs._tag === "None") {
      return null;
    }
    const info = yield* Effect.option(fs.stat(abs.value));
    return info._tag === "Some" && info.value.type === "File"
      ? abs.value
      : null;
  });

  /**
   * The images found where a favicon or an app icon is kept, in the application's folder first,
   * then the project's: each by its path from the project's folder, the favicons first.
   */
  const found = Effect.gen(function* () {
    const paths = yield* RepoPaths;
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
    const present = yield* Effect.forEach(
      candidates,
      (rel) => Effect.map(file(rel), (abs) => (abs ? rel : null)),
      { concurrency: 16 }
    );
    return present.filter((rel) => rel !== null);
  });

  /**
   * The icon shown for the project with these settings: the one they give, when its file is
   * still there; else the first image found, else the name's initial in a colour.
   */
  const shown = Effect.fnUntraced(function* (settings: Settings, name: string) {
    const { icon } = settings;
    if (icon?.kind === "icon") {
      return icon;
    }
    if (icon?.kind === "file" && (yield* file(icon.path))) {
      return icon;
    }
    const [first] = yield* found;
    return first ? ({ kind: "file", path: first } as const) : initialOf(name);
  });

  return { file, found, shown };
};
