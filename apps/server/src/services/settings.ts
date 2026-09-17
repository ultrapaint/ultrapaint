import {
  Settings,
  type SettingsValidation,
} from "@ultrapaint/contracts/settings";
import { Context, Effect, FileSystem, Layer, Path, Ref, Schema } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { AppLog } from "../app-log.ts";
import { makeWriteAtomic } from "../atomic-write.ts";
import { ServerConfig } from "../config.ts";
import { runGit } from "./git.ts";

const SettingsJson = Schema.fromJsonString(Settings);
const decodeSettings = Schema.decodeUnknownEffect(SettingsJson);
const encodeSettings = Schema.encodeEffect(Settings);

/** Tool-local settings, persisted as `settings.json` under the home directory. */
export class SettingsService extends Context.Service<
  SettingsService,
  {
    readonly get: Effect.Effect<Settings | null>;
    /** Validates and, when valid, persists. Returns the validation either way. */
    readonly set: (settings: Settings) => Effect.Effect<SettingsValidation>;
    readonly validate: (
      settings: Settings
    ) => Effect.Effect<SettingsValidation>;
  }
>()("ultrapaint/server/SettingsService") {
  static readonly layer = Layer.effect(
    SettingsService,
    Effect.gen(function* () {
      const { home } = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const log = yield* AppLog;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const file = path.join(home, "settings.json");
      const writeAtomic = makeWriteAtomic(fs, path);

      yield* Effect.orDie(fs.makeDirectory(home, { recursive: true }));
      const exists = (p: string) =>
        Effect.orElseSucceed(fs.exists(p), () => false);

      const initial = (yield* exists(file))
        ? yield* fs.readFileString(file).pipe(
            Effect.flatMap(decodeSettings),
            // A hand-edited or outdated file must not stop the server from starting.
            Effect.catch((error) =>
              Effect.as(
                log.log(
                  "server",
                  "warn",
                  `ignoring invalid settings at ${file}: ${error.message}`
                ),
                null
              )
            )
          )
        : null;
      const current = yield* Ref.make<Settings | null>(initial);

      const gitLine = (cwd: string, args: readonly string[]) =>
        runGit(cwd, args).pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            spawner
          ),
          Effect.map((r) => (r.exitCode === 0 ? r.stdout.trim() : "")),
          // Git missing or not runnable reads the same as "not a work tree".
          Effect.orElseSucceed(() => "")
        );

      const validate = Effect.fn("SettingsService.validate")(function* (
        settings: Settings
      ) {
        const problems: string[] = [];
        const repo = path.resolve(settings.repoPath);
        if (!path.isAbsolute(settings.repoPath)) {
          problems.push("Repository path must be absolute.");
        }
        if (yield* exists(repo)) {
          if (!(yield* exists(path.join(repo, "package.json")))) {
            problems.push("Repository has no package.json.");
          }
          const inside = yield* gitLine(repo, [
            "rev-parse",
            "--is-inside-work-tree",
          ]);
          if (inside !== "true") {
            problems.push("Repository path is not a git work tree.");
          }
        } else {
          problems.push(`Repository path does not exist: ${repo}`);
        }
        const designs = path.join(repo, settings.designsDir);
        if (!(yield* exists(designs))) {
          problems.push(
            `Designs directory does not exist: ${settings.designsDir}`
          );
        } else if (!(yield* exists(path.join(designs, "package.json")))) {
          problems.push(
            "Designs directory should be a workspace package with its own package.json so screens can resolve React and the design system."
          );
        }
        for (const dir of settings.libraryDirs) {
          if (!(yield* exists(path.join(repo, dir)))) {
            problems.push(`Library directory does not exist: ${dir}`);
          }
        }
        const ok = problems.length === 0;
        return {
          branch: ok
            ? yield* gitLine(repo, ["rev-parse", "--abbrev-ref", "HEAD"])
            : undefined,
          ok,
          problems,
          repoName: path.basename(repo),
        } satisfies SettingsValidation;
      });

      const set = Effect.fn("SettingsService.set")(function* (
        settings: Settings
      ) {
        const validation = yield* validate(settings);
        if (!validation.ok) {
          return validation;
        }
        const next = { ...settings, repoPath: path.resolve(settings.repoPath) };
        const encoded = yield* Effect.orDie(encodeSettings(next));
        yield* Effect.orDie(
          writeAtomic(file, JSON.stringify(encoded, null, 2))
        );
        yield* Ref.set(current, next);
        return validation;
      });

      return SettingsService.of({ get: Ref.get(current), set, validate });
    })
  );
}
