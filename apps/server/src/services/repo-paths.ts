import { ForbiddenPath } from "@ultrapaint/contracts/errors";
import type { Settings } from "@ultrapaint/contracts/settings";
import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { toPosix } from "../hash.ts";

/**
 * Every filesystem path the server touches on behalf of the editor or an agent goes through
 * here. Paths are resolved against the repository, symlinks are followed, and anything that
 * ends up outside the repository is refused.
 */
export class RepoPaths extends Context.Service<
  RepoPaths,
  {
    /**
     * Package the pages resolve their imports from: the one the settings name, or the
     * nearest package around the designs directory, which may be the designs directory itself.
     */
    readonly anchorDir: string;
    readonly designsDir: string;
    readonly isEditable: (rel: string) => boolean;
    readonly isInDesigns: (rel: string) => boolean;
    /** Repo-relative posix path for an absolute path inside the repository. */
    readonly relative: (abs: string) => string;
    /** Resolves a repo-relative or absolute path and refuses anything outside the repository. */
    readonly resolve: (p: string) => Effect.Effect<string, ForbiddenPath>;
    readonly root: string;
    readonly settings: Settings;
  }
>()("ultrapaint/server/RepoPaths") {
  static readonly layer = (settings: Settings) =>
    Layer.effect(
      RepoPaths,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        // The real path, so that paths agree with what watchers and the preview's bundler
        // report for a repository reached through a symlink (`/tmp` on macOS).
        const root = yield* Effect.orDie(
          fs.realPath(path.resolve(settings.repoPath))
        );
        const realRoot = root;
        const designs = toPosix(settings.designsDir);

        const exists = (p: string) =>
          Effect.orElseSucceed(fs.exists(p), () => false);

        // Walk up to the nearest existing ancestor so symlinked parents are followed.
        const nearestExisting = Effect.fnUntraced(function* (abs: string) {
          let probe = abs;
          while (!(yield* exists(probe))) {
            const parent = path.dirname(probe);
            if (parent === probe) {
              return probe;
            }
            probe = parent;
          }
          return yield* Effect.orElseSucceed(fs.realPath(probe), () => probe);
        });

        const resolve = Effect.fn("RepoPaths.resolve")(function* (p: string) {
          const abs = path.isAbsolute(p)
            ? path.resolve(p)
            : path.resolve(root, p);
          const real = yield* nearestExisting(abs);
          if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
            return yield* new ForbiddenPath({
              message: `path escapes the repository: ${p}`,
            });
          }
          return abs;
        });

        const designsDir = path.join(root, settings.designsDir);
        const nearestPackage = Effect.fnUntraced(function* (from: string) {
          let dir = from;
          while (dir.startsWith(root) && dir !== path.dirname(dir)) {
            if (yield* exists(path.join(dir, "package.json"))) {
              return dir;
            }
            dir = path.dirname(dir);
          }
          return root;
        });
        const anchorDir =
          settings.resolveFrom === undefined
            ? yield* nearestPackage(designsDir)
            : path.join(root, settings.resolveFrom);

        const isInDesigns = (rel: string) => {
          const posix = toPosix(rel);
          return posix === designs || posix.startsWith(`${designs}/`);
        };

        return RepoPaths.of({
          anchorDir,
          designsDir,
          isEditable: (rel) =>
            isInDesigns(rel) &&
            !toPosix(rel).includes("/.ultrapaint/") &&
            !toPosix(rel).includes("/node_modules/"),
          isInDesigns,
          relative: (abs) => toPosix(path.relative(root, abs)),
          resolve,
          root,
          settings,
        });
      })
    );
}
