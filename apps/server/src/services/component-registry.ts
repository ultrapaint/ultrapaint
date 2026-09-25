import { Context, Effect, FileSystem, Layer, Path, Ref } from "effect";
import { makeWriteAtomic } from "../atomic-write.ts";
import { ProjectFramework } from "./framework.ts";
import { RepoPaths } from "./repo-paths.ts";

/** Directory in the designs directory the preview is generated into. */
export const PREVIEW_DIR = ".ultrapaint";

const SPECIFIER_RE = /^[\w@][\w@./-]*$/;

/**
 * The component modules the preview can import, which is what an instance is drawn from. The
 * catalogue names them; the registry keeps the generated module that lists them in step, so a
 * component catalogued while the preview runs is there without a restart. Only specifiers the
 * catalogue found get in: a module the dev server cannot resolve would break every page.
 */
export class ComponentRegistry extends Context.Service<
  ComponentRegistry,
  {
    readonly current: Effect.Effect<readonly string[]>;
    /** Adds these modules, rewriting the registry when any of them is new. */
    readonly ensure: (specifiers: Iterable<string>) => Effect.Effect<void>;
  }
>()("ultrapaint/server/ComponentRegistry") {
  static readonly layer = Layer.effect(
    ComponentRegistry,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const framework = yield* ProjectFramework;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      const known = yield* Ref.make<ReadonlySet<string>>(new Set());
      const file = path.join(
        paths.designsDir,
        PREVIEW_DIR,
        framework.preview.components.file
      );

      const ensure = Effect.fnUntraced(function* (
        specifiers: Iterable<string>
      ) {
        const before = yield* Ref.get(known);
        const next = new Set(before);
        for (const specifier of specifiers) {
          if (SPECIFIER_RE.test(specifier)) {
            next.add(specifier);
          }
        }
        if (next.size === before.size) {
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
        ensure,
      });
    })
  );
}
