import { BadRequest, ForbiddenPath } from "@ultrapaint/contracts/errors";
import { defaultFramework } from "@ultrapaint/contracts/settings";
import type {
  CreateDesignsInput,
  CreateDesignsResult,
  SetupSuggestions,
} from "@ultrapaint/contracts/setup";
import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { toPosix } from "../hash.ts";
import { locateFramework } from "./framework.ts";

/**
 * The first-run setup: looks at a repository before anything is configured, and creates the
 * directory the pages will live in. It is the only part of the server that writes into a
 * repository no project is open for, so it checks every path itself.
 */
export class SetupService extends Context.Service<
  SetupService,
  {
    readonly createDesigns: (
      input: CreateDesignsInput
    ) => Effect.Effect<CreateDesignsResult, BadRequest | ForbiddenPath>;
    readonly detect: (
      repoPath: string
    ) => Effect.Effect<SetupSuggestions, BadRequest>;
  }
>()("ultrapaint/server/SetupService") {
  static readonly layer = Layer.effect(
    SetupService,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const exists = (p: string) =>
        Effect.orElseSucceed(fs.exists(p), () => false);

      const repository = Effect.fnUntraced(function* (repoPath: string) {
        if (!(path.isAbsolute(repoPath) && (yield* exists(repoPath)))) {
          return yield* new BadRequest({
            message: `Repository path does not exist: ${repoPath}`,
          });
        }
        return yield* Effect.orDie(fs.realPath(repoPath));
      });

      const detect = Effect.fn("SetupService.detect")(function* (
        repoPath: string
      ) {
        const root = yield* repository(repoPath);
        const { framework } = yield* locateFramework(defaultFramework, root);
        // Reads manifests and directory listings, a few hundred milliseconds on a large
        // monorepo, and only when the setup asks for it.
        const found = yield* Effect.sync(() => framework.detect(root));
        return {
          anchors: found?.anchors ?? [],
          cssEntries: found?.cssEntries ?? [],
          designsDirs: found?.designsDirs ?? [],
          framework: defaultFramework,
          libraries: found?.libraries ?? [],
          repoName: path.basename(root),
          tailwind: found?.tailwind ?? "none",
        } satisfies SetupSuggestions;
      });

      const createDesigns = Effect.fn("SetupService.createDesigns")(function* (
        input: CreateDesignsInput
      ) {
        const root = yield* repository(input.repoPath);
        const inside = (abs: string) =>
          abs === root || abs.startsWith(root + path.sep);
        const designs = path.resolve(root, input.designsDir);
        const anchor =
          input.resolveFrom === undefined
            ? null
            : path.resolve(root, input.resolveFrom);
        if (!(inside(designs) && (anchor === null || inside(anchor)))) {
          return yield* new ForbiddenPath({
            message: "the designs directory must be inside the repository",
          });
        }
        if (anchor && !(yield* exists(path.join(anchor, "package.json")))) {
          return yield* new BadRequest({
            message: `${input.resolveFrom} has no package.json`,
          });
        }

        const created: string[] = [];
        const record = (abs: string) =>
          created.push(toPosix(path.relative(root, abs)));
        yield* Effect.orDie(
          Effect.gen(function* () {
            if (!(yield* exists(designs))) {
              yield* fs.makeDirectory(designs, { recursive: true });
              record(designs);
            }
          })
        );
        return { created } satisfies CreateDesignsResult;
      });

      return SetupService.of({ createDesigns, detect });
    })
  );
}
