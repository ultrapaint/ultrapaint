/**
 * `capture`: a reference's pictures at every viewport, the fold and the whole page in tiles, and
 * its content in reading order. Kept with the reference, since a site changes: every round
 * compares against the same capture.
 *
 * A shot (`image`) is one picture: it is the desktop fold, and its parts, enlarged, are
 * `zoom-1.jpg` onwards, where the brief's writer and the judge read its small text.
 */
import path from "node:path";
import { Effect, FileSystem } from "effect";
import { Browser } from "./browser.ts";
import { EvalsConfig } from "./config.ts";
import { fetchPicture } from "./fetch-picture.ts";
import { listDir, writeText } from "./layout.ts";
import { type LoadedReference, viewportsOf } from "./reference.ts";

const DEFAULT_WAIT_MS = 1500;

/** `desktop-fold.jpg`, then `desktop-01.jpg` onwards: the names a hand capture uses too. */
export const foldName = (viewport: string) => `${viewport}-fold.jpg`;
export const tileName = (viewport: string, index: number) =>
  `${viewport}-${String(index + 1).padStart(2, "0")}.jpg`;
export const zoomName = (index: number) => `zoom-${index + 1}.jpg`;
export const CONTENT_FILE = "content.md";

/** A shot downloaded: the picture whole as the fold, and its parts enlarged. */
const captureImage = Effect.fn("captureImage")(function* (
  reference: LoadedReference,
  image: string,
  dir: string
) {
  const fs = yield* FileSystem.FileSystem;
  const browser = yield* Browser;
  const downloaded = yield* fetchPicture(image);
  const zoomed = yield* browser.zoom(downloaded.bytes, downloaded.mime);
  yield* fs.writeFile(path.join(dir, foldName("desktop")), zoomed.whole);
  yield* Effect.forEach(zoomed.parts, (part, index) =>
    fs.writeFile(path.join(dir, zoomName(index)), part)
  );
  yield* Effect.log(
    `${reference.id}: a ${zoomed.size.width} × ${zoomed.size.height} picture, and ${zoomed.parts.length} enlarged parts`
  );
});

export const captureReference = Effect.fn("captureReference")(function* (
  reference: LoadedReference,
  force: boolean
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const browser = yield* Browser;
  const dir = data.captureDir(reference.id);
  const existing = yield* listDir(dir);
  if (existing.length > 0 && !force) {
    yield* Effect.log(`${reference.id}: already captured (--force to redo)`);
    return;
  }
  if (reference.url === undefined && reference.image === undefined) {
    yield* Effect.logWarning(
      `${reference.id}: no url and no image, so its pictures go in ${data.fromData(dir)} by hand (${foldName("desktop")}, ${tileName("desktop", 0)}…)`
    );
    return;
  }
  yield* fs.remove(dir, { force: true, recursive: true });
  yield* fs.makeDirectory(dir, { recursive: true });
  if (reference.url === undefined) {
    return yield* captureImage(reference, reference.image ?? "", dir);
  }
  const { url } = reference;
  for (const viewport of viewportsOf(reference)) {
    const shot = yield* browser.capture(url, viewport, {
      hide: reference.hide ?? [],
      waitMs: reference.waitMs ?? DEFAULT_WAIT_MS,
    });
    yield* fs.writeFile(path.join(dir, foldName(viewport.name)), shot.fold);
    yield* Effect.forEach(shot.tiles, (tile, index) =>
      fs.writeFile(path.join(dir, tileName(viewport.name, index)), tile)
    );
    if (shot.outline !== undefined) {
      yield* writeText(
        path.join(dir, CONTENT_FILE),
        `<!-- The text and controls of ${url} at ${viewport.width}px, in reading order. -->\n\n${shot.outline}\n`
      );
    }
    yield* Effect.log(
      `${reference.id}: ${viewport.name}, the fold and ${shot.tiles.length} tiles`
    );
  }
});
