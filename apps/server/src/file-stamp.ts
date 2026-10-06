import { Effect, type FileSystem, Option } from "effect";

/**
 * What tells a file was written since it was last looked at: which file it is (an atomic write
 * makes a new one), its size and its time of change. A file that is not there stamps as `-`.
 */
export const makeStamp = (fs: FileSystem.FileSystem) => {
  const one = (file: string) =>
    Effect.map(Effect.option(fs.stat(file)), (info) =>
      Option.match(info, {
        onNone: () => "-",
        onSome: (i) =>
          `${Option.getOrElse(i.ino, () => 0)}:${i.size}:${Option.getOrElse(
            Option.map(i.mtime, (d) => d.getTime()),
            () => 0
          )}`,
      })
    );
  return (files: readonly string[]) =>
    Effect.map(Effect.forEach(files, one), (stamps) => stamps.join("|"));
};

/**
 * A reading kept until one of the files it was read from changes, which costs a `stat` of
 * each instead of reading and parsing them again. The files are stamped before they are read,
 * so a change made during the reading is seen by the next call. Which files a reading needs is
 * only known once it is done: a reading whose files are not those of the one before is not
 * kept, and the next call reads again with the right ones.
 */
export const makeStampedCache = <A, E, R>(
  fs: FileSystem.FileSystem,
  read: Effect.Effect<
    { readonly files: readonly string[]; readonly value: A },
    E,
    R
  >
) => {
  const stampOf = makeStamp(fs);
  let files: readonly string[] = [];
  let kept: { readonly stamp: string; readonly value: A } | null = null;
  // Bumped by `clear`, so a reading begun before it is not kept after it.
  let generation = 0;
  return {
    /** Forgets the reading: for a change its files cannot show. */
    clear: Effect.sync(() => {
      kept = null;
      generation += 1;
    }),
    get: Effect.gen(function* () {
      const began = generation;
      const before = files;
      const stamp = yield* stampOf(before);
      if (kept !== null && kept.stamp === stamp) {
        return kept.value;
      }
      const result = yield* read;
      const same =
        result.files.length === before.length &&
        result.files.every((file, i) => file === before[i]);
      if (began === generation) {
        ({ files } = result);
        kept = same ? { stamp, value: result.value } : null;
      }
      return result.value;
    }),
  };
};
