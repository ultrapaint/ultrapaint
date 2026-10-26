import { Effect, type FileSystem, Option, type Path, Semaphore } from "effect";
import ignore, { type Ignore } from "ignore";

/** A file of the folder as `stat` sees it: enough to tell that it changed without reading it. */
export interface TreeEntry {
  readonly mtimeMs: number;
  /** Repo-relative, with forward slashes. */
  readonly path: string;
  readonly size: number;
}

/**
 * Directories never walked, whatever `.gitignore` says: installs, builds, and git's own. A
 * folder without git has no `.gitignore` to leave them out.
 */
const ALWAYS_SKIPPED = new Set([".git", "dist", "node_modules"]);

/** Files looked at together, across the whole walk: deep trees must not run out of handles. */
const CONCURRENCY = 32;

const entryOf = (rel: string, info: FileSystem.File.Info): TreeEntry => ({
  mtimeMs: Option.match(info.mtime, {
    onNone: () => 0,
    onSome: (date) => date.getTime(),
  }),
  path: rel,
  size: Number(info.size),
});

interface Rules {
  /** Where the `.gitignore` is, repo-relative, `""` at the root. */
  readonly base: string;
  readonly rules: Ignore;
}

/** Whether a `.gitignore` of an ancestor ignores the path; a later, deeper one is asked last. */
const ignoredBy = (
  stack: readonly Rules[],
  rel: string,
  directory: boolean
) => {
  let ignored = false;
  for (const { base, rules } of stack) {
    const local = base === "" ? rel : rel.slice(base.length + 1);
    const result = rules.test(directory ? `${local}/` : local);
    if (result.ignored) {
      ignored = true;
    } else if (result.unignored) {
      ignored = false;
    }
  }
  return ignored;
};

/**
 * Every file of a folder that git would not ignore, with its time and size, without git: the
 * `.gitignore` files of the folder and its subdirectories are read as git reads them, and
 * `.git/info/exclude` with them. `skip` names further directories, absolute, that are never
 * walked: the tool's own state directory. A directory reached twice through a symbolic link is
 * walked once.
 */
export const makeTreeWalk = (fs: FileSystem.FileSystem, path: Path.Path) => {
  const readRules = (file: string) =>
    Effect.orElseSucceed(
      Effect.map(fs.readFileString(file), (text): Ignore | null =>
        ignore().add(text)
      ),
      () => null
    );

  /** One walk: what it found, the directories it has been in, and its share of handles. */
  const walker = (
    io: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
    skip: ReadonlySet<string>
  ) => {
    const found: TreeEntry[] = [];
    const seen = new Set<string>();

    /** Whether the walk goes into a directory; each one once, however many links lead to it. */
    const walksInto = (
      name: string,
      abs: string,
      child: string,
      stack: readonly Rules[],
      info: FileSystem.File.Info
    ) => {
      if (
        ALWAYS_SKIPPED.has(name) ||
        skip.has(abs) ||
        ignoredBy(stack, child, true)
      ) {
        return false;
      }
      const id = `${info.dev}:${Option.getOrElse(info.ino, () => abs)}`;
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    };

    const visitEntry = (
      dir: string,
      rel: string,
      stack: readonly Rules[],
      name: string
    ): Effect.Effect<void> => {
      const abs = path.join(dir, name);
      const child = rel === "" ? name : `${rel}/${name}`;
      // An entry can vanish between listing and stat, or be a link to nowhere.
      return Effect.flatMap(Effect.option(io(fs.stat(abs))), (info) => {
        if (Option.isNone(info)) {
          return Effect.void;
        }
        if (info.value.type === "Directory") {
          return walksInto(name, abs, child, stack, info.value)
            ? visit(abs, child, stack)
            : Effect.void;
        }
        if (info.value.type === "File" && !ignoredBy(stack, child, false)) {
          found.push(entryOf(child, info.value));
        }
        return Effect.void;
      });
    };

    const visit = (
      dir: string,
      rel: string,
      inherited: readonly Rules[]
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const own = yield* io(readRules(path.join(dir, ".gitignore")));
        const stack = own
          ? [...inherited, { base: rel, rules: own }]
          : inherited;
        const names = yield* Effect.orElseSucceed(
          io(fs.readDirectory(dir)),
          (): string[] => []
        );
        yield* Effect.forEach(
          names,
          (name) => visitEntry(dir, rel, stack, name),
          { concurrency: "unbounded", discard: true }
        );
      });

    return { found, visit };
  };

  return Effect.fnUntraced(function* (
    root: string,
    options: { readonly skip?: readonly string[] } = {}
  ) {
    const handles = yield* Semaphore.make(CONCURRENCY);
    const { found, visit } = walker(
      handles.withPermits(1),
      new Set(options.skip ?? [])
    );
    const exclude = yield* readRules(
      path.join(root, ".git", "info", "exclude")
    );
    yield* visit(root, "", exclude ? [{ base: "", rules: exclude }] : []);
    return found.sort((a, b) =>
      a.path < b.path ? -1 : Number(a.path > b.path)
    );
  });
};

export type TreeWalk = ReturnType<typeof makeTreeWalk>;
