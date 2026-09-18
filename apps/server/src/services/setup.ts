import { BadRequest, ForbiddenPath } from "@ultrapaint/contracts/errors";
import { defaultFramework } from "@ultrapaint/contracts/settings";
import type {
  CreateDesignsInput,
  CreateDesignsResult,
  SetupSuggestions,
} from "@ultrapaint/contracts/setup";
import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { makeWriteAtomic } from "../atomic-write.ts";
import { toPosix } from "../hash.ts";
import { locateFramework } from "./framework.ts";
import { runGit } from "./git.ts";

/** Enough for editors and `tsc`; the repository's own config takes over when there is one. */
const tsconfig = (anchorConfig: string | null) =>
  `${JSON.stringify(
    {
      ...(anchorConfig ? { extends: anchorConfig } : {}),
      compilerOptions: {
        allowImportingTsExtensions: true,
        jsx: "react-jsx",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "Bundler",
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: "ES2022",
      },
      exclude: [".ultrapaint", "node_modules"],
      include: ["**/*.ts", "**/*.tsx"],
    },
    null,
    2
  )}\n`;

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
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const writeAtomic = makeWriteAtomic(fs, path);

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
        } satisfies SetupSuggestions;
      });

      const ignored = (root: string, rel: string) =>
        runGit(root, ["check-ignore", "-q", rel]).pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            spawner
          ),
          Effect.map((r) => r.exitCode === 0),
          // Without git nothing can be committed by accident either.
          Effect.orElseSucceed(() => true)
        );

      /** A `tsconfig.json` for the designs directory, unless it has one. */
      const writeConfig = Effect.fnUntraced(function* (
        designs: string,
        anchor: string | null,
        record: (abs: string) => void
      ) {
        const config = path.join(designs, "tsconfig.json");
        if (yield* exists(config)) {
          return;
        }
        const anchorConfig = anchor && path.join(anchor, "tsconfig.json");
        const inherits = anchorConfig && (yield* exists(anchorConfig));
        yield* writeAtomic(
          config,
          tsconfig(
            inherits ? toPosix(path.relative(designs, anchorConfig)) : null
          )
        );
        record(config);
      });

      /**
       * Links the anchor's `node_modules` into the designs directory and keeps the link out of
       * git. Editors and `tsc` then resolve what the pages import; the preview never needs it.
       */
      const linkDependencies = Effect.fnUntraced(function* (
        root: string,
        designs: string,
        anchor: string,
        record: (abs: string) => void
      ) {
        const link = path.join(designs, "node_modules");
        const target = path.join(anchor, "node_modules");
        if (!(yield* exists(target)) || (yield* exists(link))) {
          return;
        }
        // Relative, so the link survives the repository being moved or cloned elsewhere.
        yield* fs.symlink(path.relative(designs, target), link);
        record(link);
        if (yield* ignored(root, toPosix(path.relative(root, link)))) {
          return;
        }
        const ignore = path.join(designs, ".gitignore");
        const current = (yield* exists(ignore))
          ? yield* fs.readFileString(ignore)
          : "";
        yield* writeAtomic(ignore, `${current}node_modules\n`);
        record(ignore);
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
            yield* writeConfig(designs, anchor, record);
            if (input.linkDependencies && anchor && anchor !== designs) {
              yield* linkDependencies(root, designs, anchor, record);
            }
          })
        );
        return { created } satisfies CreateDesignsResult;
      });

      return SetupService.of({ createDesigns, detect });
    })
  );
}
