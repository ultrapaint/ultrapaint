import { BadRequest, ForbiddenPath } from "@ultrapaint/contracts/errors";
import {
  DEFAULT_DESIGNS_DIR,
  defaultFramework,
} from "@ultrapaint/contracts/settings";
import {
  type CreateDesignsInput,
  type CreateDesignsResult,
  relativePosix,
  type ScaffoldInput,
  type ScaffoldResult,
  type SetupSuggestions,
} from "@ultrapaint/contracts/setup";
import { defaultStyleSystem } from "@ultrapaint/contracts/tokens";
import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { makeWriteAtomic } from "../atomic-write.ts";
import { makeExists } from "../fs-exists.ts";
import { toPosix } from "../hash.ts";
import { runCommand } from "../process.ts";
import { locateFramework } from "./framework.ts";
import { locateStyleSystem } from "./style-system.ts";

/** `"packageManager": "pnpm@10.0.0"` in a package.json. */
const PACKAGE_MANAGER_RE = /"packageManager"\s*:\s*"(pnpm|yarn|npm|bun)@/;
/** The last lines of a failed install are what the user is shown. */
const INSTALL_LOG_LINES = 12;

/** What an install came to. */
export interface Installed {
  readonly installed: boolean;
  /** The install's last lines, when it failed. */
  readonly installLog?: string;
  /** The package manager it was installed with, or would have been. */
  readonly packageManager: string;
}

/**
 * The first-run setup: looks at a repository before anything is configured, creates the
 * directory the pages will live in, and starts an application where there is none (ADR 0025).
 * It is the only part of the server that writes into a repository no project is open for, so it
 * checks every path itself.
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
    /**
     * Installs the application in `dir` (repo-relative) with `packageManager`, or the one the
     * repository is set up with. Whether it was installed, and what went wrong when it was not,
     * in the install's last lines.
     */
    readonly install: (input: {
      readonly dir: string;
      readonly packageManager?: string | undefined;
      readonly repoPath: string;
    }) => Effect.Effect<Installed, BadRequest | ForbiddenPath>;
    /**
     * Writes a new application into the repository, installs it when asked, and answers with
     * the settings that point the tool at it. `tokens` start its theme (a Figma file's).
     */
    readonly scaffold: (
      input: ScaffoldInput,
      tokens: Readonly<Record<string, string>>
    ) => Effect.Effect<ScaffoldResult, BadRequest | ForbiddenPath>;
  }
>()("ultrapaint/server/SetupService") {
  static readonly layer = Layer.effect(
    SetupService,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const writeAtomic = makeWriteAtomic(fs, path);

      const exists = makeExists(fs);

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
        // The stylesheets are looked for in the packages the framework proposed: the best
        // anchors, and the libraries (ADR 0024).
        const styleSystem = yield* Effect.orDie(
          locateStyleSystem(defaultStyleSystem)
        );
        const dirs = [
          ...(found?.anchors ?? []).slice(0, 2).map((a) => a.dir),
          ...(found?.libraries ?? []).map((l) => l.dir),
        ].map((dir) => path.resolve(root, dir));
        const styles = yield* Effect.sync(() =>
          styleSystem.detect(root, [...new Set(dirs)])
        );
        return {
          anchors: found?.anchors ?? [],
          cssEntries: [...styles.cssEntries],
          designsDirs: found?.designsDirs ?? [],
          framework: defaultFramework,
          libraries: found?.libraries ?? [],
          repoName: path.basename(root),
          rootManifest: yield* exists(path.join(root, "package.json")),
          ...(styles.tailwind === "v4" && { styleSystem: styleSystem.id }),
          tailwind: styles.tailwind,
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

      /** The package manager the repository is set up with, by its lockfile or manifest. */
      const packageManagerOf = Effect.fnUntraced(function* (root: string) {
        const has = (file: string) => exists(path.join(root, file));
        if (yield* has("pnpm-lock.yaml")) {
          return "pnpm";
        }
        if (yield* has("yarn.lock")) {
          return "yarn";
        }
        if ((yield* has("bun.lock")) || (yield* has("bun.lockb"))) {
          return "bun";
        }
        if (yield* has("package-lock.json")) {
          return "npm";
        }
        const manifest = yield* fs
          .readFileString(path.join(root, "package.json"))
          .pipe(Effect.orElseSucceed(() => ""));
        const named: RegExpExecArray | null = PACKAGE_MANAGER_RE.exec(manifest);
        if (named?.[1]) {
          return named[1];
        }
        // Nothing says: pnpm when it is there, npm otherwise.
        const pnpm = yield* runCommand("pnpm", ["--version"], {
          cwd: root,
          timeout: "10 seconds",
        }).pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            spawner
          ),
          Effect.map((r) => r.exitCode === 0),
          Effect.orElseSucceed(() => false)
        );
        return pnpm ? "pnpm" : "npm";
      });

      /** Installs the application; what went wrong, in its last lines, when it did not. */
      const installIn = Effect.fnUntraced(function* (
        packageManager: string,
        target: string,
        dir: string
      ) {
        // Outside a workspace's globs, pnpm would install the workspace instead.
        const args =
          packageManager === "pnpm" && dir !== "."
            ? ["install", "--ignore-workspace"]
            : ["install"];
        const result = yield* runCommand(packageManager, args, {
          cwd: target,
          timeout: "10 minutes",
        }).pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            spawner
          ),
          // Not installed, or it could not run: the user installs, the files are there.
          Effect.orElseSucceed(() => null)
        );
        if (result?.exitCode === 0) {
          return { installed: true, packageManager } satisfies Installed;
        }
        const log = result
          ? `${result.stdout}\n${result.stderr}`
          : // Not there, or its interpreter is not: a package manager runs on Node.
            `${packageManager} could not run: is Node.js installed?`;
        return {
          installed: false,
          installLog: log
            .trim()
            .split("\n")
            .slice(-INSTALL_LOG_LINES)
            .join("\n"),
          packageManager,
        } satisfies Installed;
      });

      /** The application's directory, inside the repository, and the repository's root. */
      const applicationDir = Effect.fnUntraced(function* (
        repoPath: string,
        dir: string
      ) {
        const root = yield* repository(repoPath);
        const target = path.resolve(root, dir);
        if (!(target === root || target.startsWith(root + path.sep))) {
          return yield* new ForbiddenPath({
            message: "the application must be inside the repository",
          });
        }
        return {
          dir: toPosix(path.relative(root, target)) || ".",
          root,
          target,
        };
      });

      const install = Effect.fn("SetupService.install")(function* (input: {
        readonly dir: string;
        readonly packageManager?: string | undefined;
        readonly repoPath: string;
      }) {
        const { dir, root, target } = yield* applicationDir(
          input.repoPath,
          input.dir
        );
        const packageManager =
          input.packageManager ?? (yield* packageManagerOf(root));
        return yield* installIn(packageManager, target, dir);
      });

      const scaffold = Effect.fn("SetupService.scaffold")(function* (
        input: ScaffoldInput,
        tokens: Readonly<Record<string, string>>
      ) {
        const { dir, root, target } = yield* applicationDir(
          input.repoPath,
          input.dir
        );
        if (yield* exists(path.join(target, "package.json"))) {
          return yield* new BadRequest({
            message: `${input.dir} already has a package.json: start the application somewhere else`,
          });
        }
        const { framework } = yield* locateFramework(defaultFramework, root);
        if (!framework.scaffold) {
          return yield* new BadRequest({
            message: `${framework.id} cannot start an application`,
          });
        }
        const made = framework.scaffold({
          dir,
          name: input.name,
          template: input.template ?? "starter",
          tokens,
        });
        for (const [file, text] of Object.entries(made.files)) {
          yield* Effect.orDie(writeAtomic(path.join(root, file), text));
        }
        // Where the pages go, so the settings are valid as they are answered.
        const designsDir = input.designsDir ?? DEFAULT_DESIGNS_DIR;
        yield* Effect.orDie(
          fs.makeDirectory(path.join(root, designsDir), { recursive: true })
        );
        const installed = input.install
          ? yield* installIn(yield* packageManagerOf(root), target, dir)
          : { installed: false, packageManager: yield* packageManagerOf(root) };
        return {
          created: Object.keys(made.files),
          ...installed,
          settings: {
            designsDir,
            hostCss: [
              relativePosix(
                `${designsDir}/.ultrapaint`,
                made.settings.hostCss
              ),
            ],
            libraryDirs: [made.settings.libraryDir],
            // The application's package, the root's included: not the designs directory.
            resolveFrom: made.settings.resolveFrom,
          },
        } satisfies ScaffoldResult;
      });

      return SetupService.of({ createDesigns, detect, install, scaffold });
    })
  );
}
