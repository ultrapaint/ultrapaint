import { Effect, type FileSystem, type Path, Random } from "effect";

/**
 * Writes through a temporary sibling and renames, so readers never see a partial file. The
 * temporary file sits next to the target to keep the rename on one filesystem.
 */
export const makeWriteAtomic = (fs: FileSystem.FileSystem, path: Path.Path) =>
  Effect.fn("writeAtomic")(function* (file: string, content: string) {
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    const suffix = (yield* Random.nextIntBetween(0, 2 ** 31)).toString(36);
    const tmp = `${file}.${suffix}.tmp`;
    yield* fs.writeFileString(tmp, content);
    yield* fs.rename(tmp, file);
  });

export type WriteAtomic = ReturnType<typeof makeWriteAtomic>;
