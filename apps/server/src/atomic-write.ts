import { Effect, type FileSystem, type Path, Random } from "effect";

/**
 * Writes through a temporary sibling and renames, so readers never see a partial file. The
 * temporary file sits next to the target to keep the rename on one filesystem.
 */
export const makeWriteAtomic = (fs: FileSystem.FileSystem, path: Path.Path) =>
  Effect.fn("writeAtomic")(function* (
    file: string,
    content: string | Uint8Array,
    /** Permissions of the file, when they are to be narrower than the default. */
    options?: { readonly mode?: number }
  ) {
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    const suffix = (yield* Random.nextIntBetween(0, 2 ** 31)).toString(36);
    const tmp = `${file}.${suffix}.tmp`;
    yield* typeof content === "string"
      ? fs.writeFileString(tmp, content, options)
      : fs.writeFile(tmp, content, options);
    yield* fs.rename(tmp, file);
  });
