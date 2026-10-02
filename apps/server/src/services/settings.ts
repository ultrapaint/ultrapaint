import { BadRequest, Conflict } from "@ultrapaint/contracts/errors";
import {
  CONFIG_FILE_NAME,
  type PersistInput,
  type PersistResult,
  ProjectConfig,
  type Settings,
  type SettingsValidation,
} from "@ultrapaint/contracts/settings";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  PubSub,
  Ref,
  Schema,
  Stream,
} from "effect";
import { ChildProcessSpawner } from "effect/process";
import { AppLog } from "../app-log.ts";
import { makeWriteAtomic } from "../atomic-write.ts";
import { runGit } from "./git.ts";
import { toConfig, toSettings } from "./project-config.ts";
import { Storage } from "./storage.ts";

const ConfigJson = Schema.fromJsonString(ProjectConfig);
const decodeConfig = Schema.decodeUnknownEffect(ConfigJson);
const encodeConfig = Schema.encodeEffect(ProjectConfig);

/** A configuration file the user pointed at, or that sits in the repository, cannot be read. */
export class ConfigInvalid extends Schema.TaggedError<ConfigInvalid>()(
  "ConfigInvalid",
  { file: Schema.String, message: Schema.String }
) {}

/** Where the settings file is and how it is written, for the current storage target. */
interface SettingsFile {
  readonly baseDir: string;
  readonly path: string;
  /** A file in a repository is shared: no absolute path goes into it. */
  readonly relative: boolean;
}

const sortKeys = (value: object) =>
  Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
  );

/** File an unsaved session keeps its settings in, inside the directory the command lends it. */
const SESSION_FILE = "session.json";

/**
 * The settings, wherever the storage target keeps them: a home directory's `settings.json`, an
 * `ultrapaint.json` in the repository, the `session.json` of an unsaved session the command
 * keeps across restarts, or only memory.
 */
export class SettingsService extends Context.Service<
  SettingsService,
  {
    /**
     * Takes settings detected in the repository the server was started in. They are kept in
     * memory only, so the next start detects again; saving them makes them the user's.
     */
    readonly adopt: (settings: Settings) => Effect.Effect<SettingsValidation>;
    /** Settings that arrived because someone else changed the configuration file. */
    readonly changes: Stream.Stream<Settings>;
    /** Whether the settings in force are detected ones nobody has saved. */
    readonly detected: Effect.Effect<boolean>;
    readonly get: Effect.Effect<Settings | null>;
    /** Saves an unsaved session to a new configuration file and keeps saving from then on. */
    readonly persist: (
      input: PersistInput
    ) => Effect.Effect<PersistResult, BadRequest | Conflict>;
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
      const storage = yield* Storage;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const log = yield* AppLog;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const layerScope = yield* Effect.scope;
      const writeAtomic = makeWriteAtomic(fs, path);
      const external = yield* PubSub.unbounded<Settings>();

      const exists = (p: string) =>
        Effect.orElseSucceed(fs.exists(p), () => false);

      const settingsFile = Effect.map(
        storage.target,
        (target): SettingsFile | null => {
          if (target.mode === "managed") {
            return {
              baseDir: target.home,
              path: path.join(target.home, "settings.json"),
              relative: false,
            };
          }
          if (target.mode === "file") {
            return {
              baseDir: path.dirname(target.configPath),
              path: target.configPath,
              relative: true,
            };
          }
          if (target.sessionDir) {
            return {
              baseDir: target.sessionDir,
              path: path.join(target.sessionDir, SESSION_FILE),
              relative: false,
            };
          }
          return null;
        }
      );

      // What this process last read or wrote, to tell our own writes from someone else's.
      let lastText: string | null = null;
      let schemaRef: string | undefined;

      const read = Effect.fnUntraced(function* (file: SettingsFile) {
        const text = yield* fs.readFileString(file.path);
        const config = yield* decodeConfig(text);
        lastText = text;
        schemaRef = config.$schema;
        return toSettings(path, config, file.baseDir);
      });

      const write = Effect.fnUntraced(function* (
        file: SettingsFile,
        settings: Settings
      ) {
        const config = toConfig(path, settings, file.baseDir, {
          relative: file.relative,
          schema: schemaRef,
        });
        const encoded = yield* encodeConfig(config);
        const text = `${JSON.stringify(sortKeys(encoded), null, 2)}\n`;
        yield* writeAtomic(file.path, text);
        lastText = text;
      }, Effect.orDie);

      const load = Effect.gen(function* () {
        const file = yield* settingsFile;
        if (!(file && (yield* exists(file.path)))) {
          return null;
        }
        const loaded = read(file);
        if (file.relative) {
          // A shared file is never silently replaced: say what is wrong with it and stop.
          return yield* Effect.mapError(
            loaded,
            (error) =>
              new ConfigInvalid({ file: file.path, message: error.message })
          );
        }
        // The home directory's own file: an outdated one must not stop the app from starting.
        return yield* Effect.catch(loaded, (error) =>
          Effect.as(
            log.log(
              "server",
              "warn",
              `ignoring invalid settings at ${file.path}: ${error.message}`
            ),
            null
          )
        );
      });

      const current = yield* Ref.make<Settings | null>(yield* load);
      let detected = false;

      // ---- changes made to the file by someone else (an editor, `git pull`) ----
      const reload = Effect.fnUntraced(function* (file: SettingsFile) {
        const text = yield* fs.readFileString(file.path);
        if (text === lastText) {
          return;
        }
        const settings = yield* read(file);
        yield* Ref.set(current, settings);
        detected = false;
        yield* log.log("server", "info", `reloaded ${file.path}`);
        yield* PubSub.publish(external, settings);
      });

      const watch = (file: SettingsFile) =>
        fs.watch(path.dirname(file.path)).pipe(
          Stream.filter(
            (event) => path.basename(event.path) === path.basename(file.path)
          ),
          Stream.debounce("120 millis"),
          Stream.runForEach(() =>
            reload(file).pipe(
              // A half-written or invalid file keeps the last good settings in force.
              Effect.catch((error) =>
                log.log(
                  "server",
                  "warn",
                  `ignoring change to ${file.path}: ${error.message}`
                )
              )
            )
          ),
          // A directory that cannot be watched only means external edits need a restart.
          Effect.ignore({ log: true }),
          Effect.forkIn(layerScope)
        );

      const initialFile = yield* settingsFile;
      if (initialFile?.relative) {
        yield* watch(initialFile);
      }

      // ---- validation ----
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
        if (!(yield* exists(path.join(repo, settings.designsDir)))) {
          problems.push(
            `Designs directory does not exist: ${settings.designsDir}`
          );
        }
        if (settings.resolveFrom !== undefined) {
          const anchor = path.join(repo, settings.resolveFrom, "package.json");
          if (!(yield* exists(anchor))) {
            problems.push(
              `The package pages resolve their imports from has no package.json: ${settings.resolveFrom}`
            );
          }
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

      const store = Effect.fnUntraced(function* (settings: Settings) {
        const next = { ...settings, repoPath: path.resolve(settings.repoPath) };
        const file = yield* settingsFile;
        if (file) {
          yield* write(file, next);
        }
        yield* Ref.set(current, next);
        detected = false;
      });

      const set = Effect.fn("SettingsService.set")(function* (
        settings: Settings
      ) {
        const validation = yield* validate(settings);
        if (validation.ok) {
          yield* store(settings);
        }
        return validation;
      });

      const adopt = Effect.fn("SettingsService.adopt")(function* (
        settings: Settings
      ) {
        const validation = yield* validate(settings);
        if (!validation.ok) {
          return validation;
        }
        const next = { ...settings, repoPath: path.resolve(settings.repoPath) };
        // Settings someone set while the repository was being read win over detected ones.
        const taken = yield* Ref.modify(current, (now) =>
          now === null ? [true, next] : [false, now]
        );
        if (!taken) {
          return {
            ok: false,
            problems: ["Settings were set in the meantime."],
          } satisfies SettingsValidation;
        }
        detected = true;
        return validation;
      });

      const persist = Effect.fn("SettingsService.persist")(function* (
        input: PersistInput
      ) {
        const target = yield* storage.target;
        if (target.mode !== "ephemeral") {
          return yield* new BadRequest({
            message: "this session already saves its configuration",
          });
        }
        const { configPath } = input;
        if (!(path.isAbsolute(configPath) && configPath.endsWith(".json"))) {
          return yield* new BadRequest({
            message:
              "The configuration file must be an absolute path to a .json file.",
          });
        }
        if (!(yield* exists(path.dirname(configPath)))) {
          return yield* new BadRequest({
            message: `Directory does not exist: ${path.dirname(configPath)}`,
          });
        }
        if (!input.overwrite && (yield* exists(configPath))) {
          return yield* new Conflict({
            message: `${configPath} already exists`,
          });
        }
        const validation = yield* validate(input.settings);
        if (!validation.ok) {
          return { validation } satisfies PersistResult;
        }
        yield* storage.promote(configPath);
        yield* store(input.settings);
        const file = yield* settingsFile;
        if (file) {
          yield* watch(file);
        }
        yield* log.log(
          "server",
          "info",
          `configuration saved to ${configPath}`
        );
        return {
          command:
            path.basename(configPath) === CONFIG_FILE_NAME
              ? `cd ${path.dirname(configPath)} && ultrapaint`
              : `ultrapaint --config ${configPath}`,
          configPath,
          validation,
        } satisfies PersistResult;
      });

      return SettingsService.of({
        adopt,
        changes: Stream.fromPubSub(external),
        detected: Effect.sync(() => detected),
        get: Ref.get(current),
        persist,
        set,
        validate,
      });
    })
  );
}
