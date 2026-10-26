import { Effect, FileSystem, Path, Random } from "effect";

/**
 * Writes through a temporary sibling and renames, so a reader, or the app started again after a
 * crash, never sees half a file.
 */
export const writeAtomic = Effect.fnUntraced(function* (
  file: string,
  content: string | Uint8Array,
  options?: { readonly mode?: number }
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(file), { recursive: true });
  const suffix = (yield* Random.nextIntBetween(0, 2 ** 31)).toString(36);
  const tmp = `${file}.${suffix}.tmp`;
  yield* typeof content === "string"
    ? fs.writeFileString(tmp, content, options)
    : fs.writeFile(tmp, content, options);
  yield* fs.rename(tmp, file);
});
