import { Effect, type FileSystem } from "effect";

/** Whether something is at the path; one that cannot be looked at counts as not there. */
export const makeExists =
  (fs: FileSystem.FileSystem) =>
  (p: string): Effect.Effect<boolean> =>
    Effect.orElseSucceed(fs.exists(p), () => false);
