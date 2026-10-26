/**
 * `capture`: a reference's pictures at every viewport, the fold and the whole page in tiles, and
 * its content in reading order. Kept with the reference, since a site changes: every round
 * compares against the same capture.
 */
import path from "node:path";
import { Effect, FileSystem } from "effect";
import { Browser } from "./browser.ts";
import { captureDir, fromLab, listDir, writeText } from "./layout.ts";
import { type LoadedReference, VIEWPORTS } from "./reference.ts";

const DEFAULT_WAIT_MS = 1500;

/** `desktop-fold.jpg`, then `desktop-01.jpg` onwards: the names a hand capture uses too. */
export const foldName = (viewport: string) => `${viewport}-fold.jpg`;
export const tileName = (viewport: string, index: number) =>
  `${viewport}-${String(index + 1).padStart(2, "0")}.jpg`;
export const CONTENT_FILE = "content.md";

export const captureReference = Effect.fn("captureReference")(function* (
  reference: LoadedReference,
  force: boolean
) {
  const fs = yield* FileSystem.FileSystem;
  const browser = yield* Browser;
  const dir = captureDir(reference.id);
  const existing = yield* listDir(dir);
  if (existing.length > 0 && !force) {
    yield* Effect.log(`${reference.id}: already captured (--force to redo)`);
    return;
  }
  if (reference.url === undefined) {
    yield* Effect.logWarning(
      `${reference.id}: no url, so its pictures go in ${fromLab(dir)} by hand (${foldName("desktop")}, ${tileName("desktop", 0)}…)`
    );
    return;
  }
  yield* fs.remove(dir, { force: true, recursive: true });
  yield* fs.makeDirectory(dir, { recursive: true });
  for (const viewport of VIEWPORTS) {
    const shot = yield* browser.capture(reference.url, viewport, {
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
        `<!-- The text and controls of ${reference.url} at ${viewport.width}px, in reading order. -->\n\n${shot.outline}\n`
      );
    }
    yield* Effect.log(
      `${reference.id}: ${viewport.name}, the fold and ${shot.tiles.length} tiles`
    );
  }
});
