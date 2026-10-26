import { Context, Effect, FileSystem, Layer, Path, Ref } from "effect";
import { makeWriteAtomic } from "../atomic-write.ts";
import { ServerConfig } from "../config.ts";
import { hashContent } from "../hash.ts";
import { ProjectFramework } from "./framework.ts";
import { RepoPaths } from "./repo-paths.ts";

/**
 * Directory in the designs directory the preview was generated into before ADR 0034. A project
 * opened still holding it has it removed, when it is ours.
 */
export const LEGACY_PREVIEW_DIR = ".ultrapaint";

/**
 * Where the preview of a designs directory is generated: the user's cache, one directory per
 * designs directory, outside the repository. Nothing of it is the design's.
 */
export const previewDirOf = (
  home: string,
  designsDir: string,
  join: (...parts: string[]) => string
) => join(home, ".cache", "ultrapaint", "preview", hashContent(designsDir));

const SPECIFIER_RE = /^[\w@#][\w@#./-]*$/;

/**
 * The component modules the preview can import, which is what an instance is drawn from. The
 * catalogue names them; the registry keeps the generated module that lists them in step, so a
 * component catalogued while the preview runs is there without a restart, and one the catalogue
 * no longer names is gone without one. Only specifiers the catalogue found get in: a module the
 * dev server cannot resolve would break every page.
 */
export class ComponentRegistry extends Context.Service<
  ComponentRegistry,
  {
    readonly current: Effect.Effect<readonly string[]>;
    /** The modules are these, as the catalogue last read them; rewritten when that changed. */
    readonly sync: (specifiers: Iterable<string>) => Effect.Effect<void>;
  }
>()("ultrapaint/server/ComponentRegistry") {
  static readonly layer = Layer.effect(
    ComponentRegistry,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const framework = yield* ProjectFramework;
      const { machine } = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      const known = yield* Ref.make<ReadonlySet<string>>(new Set());
      const file = path.join(
        previewDirOf(machine.home, paths.designsDir, path.join),
        framework.preview.components.file
      );

      const sync = Effect.fnUntraced(function* (specifiers: Iterable<string>) {
        const before = yield* Ref.get(known);
        const next = new Set<string>();
        for (const specifier of specifiers) {
          if (SPECIFIER_RE.test(specifier)) {
            next.add(specifier);
          }
        }
        if (
          next.size === before.size &&
          [...next].every((specifier) => before.has(specifier))
        ) {
          return;
        }
        yield* Ref.set(known, next);
        yield* Effect.ignore(
          writeAtomic(file, framework.preview.components.render([...next])),
          { log: true }
        );
      });

      return ComponentRegistry.of({
        current: Effect.map(Ref.get(known), (set) => [...set].sort()),
        sync,
      });
    })
  );
}
