/**
 * A new design from nothing (PLAN-desktop D11, ADR 0031): a folder with a configuration, so that
 * the server finds it and the desktop app attaches to it, a designs directory, an application
 * from a template (the setup's own scaffold, ADR 0025), its packages installed and, when the git
 * integration is on, a first commit. `ultrapaint new` runs it, for the command and for the
 * desktop app alike, before any server runs in the folder.
 *
 * Each step is reported as it starts and ends. A step that fails stops the rest and leaves what
 * the ones before it did: the folder opens as a project, and running the same again finishes
 * it, the files being written already (its configuration says so).
 */

import {
  codeDirOf,
  NEW_DESIGNS_DIR,
  type NewDesignOptions,
  type NewDesignProgress,
  type NewDesignStep,
} from "@ultrapaint/contracts/new-design";
import {
  CONFIG_FILE_NAME,
  defaultSettings,
  ProjectConfig,
} from "@ultrapaint/contracts/settings";
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { makeWriteAtomic } from "../atomic-write.ts";
import { makeExists } from "../fs-exists.ts";
import { git } from "./git.ts";
import { configText, toConfig } from "./project-config.ts";
import { SetupService } from "./setup.ts";

/** A step that could not be done, and why; the steps before it stay done. */
export class NewDesignFailed extends Schema.TaggedError<NewDesignFailed>()(
  "NewDesignFailed",
  { message: Schema.String, step: Schema.String }
) {}

export interface NewDesignResult {
  readonly configPath: string;
  readonly folder: string;
  readonly installed: boolean;
}

/** What a folder may hold and still count as empty: what a system or `git init` leaves. */
const LEFT_BY_OTHERS = new Set([".DS_Store", "Thumbs.db", ".git"]);

const encodeConfig = Schema.encodeEffect(ProjectConfig);

/** What a step did: done, with a word on it, or not needed. */
interface Outcome {
  readonly detail?: string;
  readonly skipped?: boolean;
}

export class NewDesignService extends Context.Service<
  NewDesignService,
  {
    /** Writes the new design, telling `report` how each step goes. */
    readonly create: (
      options: NewDesignOptions,
      report: (progress: NewDesignProgress) => Effect.Effect<void>
    ) => Effect.Effect<NewDesignResult, NewDesignFailed>;
  }
>()("ultrapaint/server/NewDesignService") {
  static readonly layer = Layer.effect(
    NewDesignService,
    Effect.gen(function* () {
      const setup = yield* SetupService;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const writeAtomic = makeWriteAtomic(fs, path);
      const exists = makeExists(fs);

      const create = Effect.fn("NewDesignService.create")(function* (
        options: NewDesignOptions,
        report: (progress: NewDesignProgress) => Effect.Effect<void>
      ) {
        /** Runs a step between its reports; its failure, a message, stops the rest. */
        const step = <R>(
          id: NewDesignStep,
          run: Effect.Effect<Outcome, string, R>
        ): Effect.Effect<Outcome, NewDesignFailed, R> =>
          Effect.gen(function* () {
            yield* report({ state: "active", step: id });
            const outcome = yield* run.pipe(
              Effect.tapError((message) =>
                report({ detail: message, state: "failed", step: id })
              ),
              Effect.mapError(
                (message) => new NewDesignFailed({ message, step: id })
              )
            );
            yield* report({
              ...(outcome.detail === undefined
                ? {}
                : { detail: outcome.detail }),
              state: outcome.skipped ? "skipped" : "done",
              step: id,
            });
            return outcome;
          });
        const said = (error: { readonly message: string }) => error.message;

        const { folder } = options;
        const configPath = path.join(folder, CONFIG_FILE_NAME);
        const dir = codeDirOf(options.code);

        yield* step(
          "folder",
          Effect.gen(function* () {
            if (!path.isAbsolute(folder)) {
              return yield* Effect.fail(`${folder} is not an absolute path`);
            }
            yield* Effect.mapError(
              fs.makeDirectory(folder, { recursive: true }),
              (error) => `${folder} could not be made: ${error.message}`
            );
            return { detail: folder };
          })
        );

        // Written by an earlier run that stopped after it: this one finishes it.
        const written = yield* exists(configPath);
        yield* step(
          "write",
          written
            ? Effect.succeed({
                detail: "Written already, by an earlier run.",
                skipped: true,
              })
            : Effect.gen(function* () {
                const there = (yield* Effect.mapError(
                  fs.readDirectory(folder),
                  said
                )).filter((name) => !LEFT_BY_OTHERS.has(name));
                if (there.length > 0) {
                  return yield* Effect.fail(
                    `${folder} is not empty (${there.slice(0, 3).join(", ")}${there.length > 3 ? ", …" : ""}): a new design starts in an empty folder.`
                  );
                }
                const made = yield* Effect.mapError(
                  setup.scaffold(
                    {
                      designsDir: NEW_DESIGNS_DIR,
                      dir,
                      install: false,
                      name: options.name,
                      repoPath: folder,
                      template: options.template,
                    },
                    {}
                  ),
                  said
                );
                const settings = {
                  ...defaultSettings(folder),
                  ...made.settings,
                  ...(options.git && { git: "on" as const }),
                };
                // Last: a configuration says the files are all there.
                yield* Effect.mapError(
                  Effect.flatMap(
                    encodeConfig(
                      toConfig(path, settings, folder, { relative: true })
                    ),
                    (encoded) => writeAtomic(configPath, configText(encoded))
                  ),
                  (error) =>
                    `${configPath} could not be written: ${error.message}`
                );
                return { detail: `${made.created.length + 1} files` };
              })
        );

        const installed = options.install
          ? yield* step(
              "install",
              Effect.gen(function* () {
                const result = yield* Effect.mapError(
                  setup.install({
                    dir,
                    packageManager: options.packageManager,
                    repoPath: folder,
                  }),
                  said
                );
                if (!result.installed) {
                  return yield* Effect.fail(
                    `${result.packageManager} install failed${result.installLog ? `:\n${result.installLog}` : "."}`
                  );
                }
                return { detail: `With ${result.packageManager}.` };
              })
            )
          : yield* step(
              "install",
              Effect.succeed({ detail: "Not asked for.", skipped: true })
            );

        if (options.git) {
          yield* step(
            "git",
            Effect.gen(function* () {
              if (yield* exists(path.join(folder, ".git"))) {
                return { detail: "A repository already.", skipped: true };
              }
              yield* git(folder, ["init", "--quiet"]);
              yield* git(folder, ["add", "--all"]);
              yield* git(folder, [
                "commit",
                "--quiet",
                "--message",
                `Start ${options.name}`,
              ]);
              return { detail: `Committed: Start ${options.name}` };
            }).pipe(
              Effect.provideService(
                ChildProcessSpawner.ChildProcessSpawner,
                spawner
              ),
              Effect.mapError(said)
            )
          );
        }

        return {
          configPath,
          folder,
          installed: !installed.skipped,
        } satisfies NewDesignResult;
      });

      return NewDesignService.of({ create });
    })
  );
}
