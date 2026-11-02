import { Effect, type FileSystem, type Path } from "effect";

interface WalkOptions {
  readonly includeFile: (name: string) => boolean;
  readonly skipDir: (name: string) => boolean;
}

/** Absolute paths of matching files under `root`, directories visited in name order. */
export const makeWalk = (fs: FileSystem.FileSystem, path: Path.Path) => {
  const visit = (
    abs: string,
    name: string,
    options: WalkOptions
  ): Effect.Effect<string[]> =>
    // An entry can vanish between listing and stat; it then contributes nothing.
    Effect.matchEffect(fs.stat(abs), {
      onFailure: () => Effect.succeed([]),
      onSuccess: (info) => {
        if (info.type === "Directory") {
          return options.skipDir(name)
            ? Effect.succeed([])
            : walk(abs, options);
        }
        const wanted = info.type === "File" && options.includeFile(name);
        return Effect.succeed(wanted ? [abs] : []);
      },
    });

  const walk = (dir: string, options: WalkOptions): Effect.Effect<string[]> =>
    Effect.orElseSucceed(fs.readDirectory(dir), (): string[] => []).pipe(
      Effect.flatMap((names) =>
        Effect.forEach(
          names.sort((a, b) => a.localeCompare(b)),
          (name) => visit(path.join(dir, name), name, options)
        )
      ),
      Effect.map((found) => found.flat())
    );
  return walk;
};
