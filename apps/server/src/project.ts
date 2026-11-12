import {
  type BadRequest,
  type Conflict,
  NotConfigured,
} from "@ultrapaint/contracts/errors";
import type { ProjectInfo } from "@ultrapaint/contracts/project";
import {
  CONFIG_FILE_NAME,
  defaultSettings,
  type PersistInput,
  type PersistResult,
  Settings,
  type SettingsValidation,
} from "@ultrapaint/contracts/settings";
import {
  applySuggestions,
  hostCssFor,
  stylesheetOf,
} from "@ultrapaint/contracts/setup";
import {
  Context,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Path,
  Schema,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { AppLog } from "./app-log.ts";
import type { ServerConfig } from "./config.ts";
import { EventBus } from "./events.ts";
import type { CodeSide } from "./services/code-side.ts";
import type { CommentsService } from "./services/comments.ts";
import type { ComponentService } from "./services/components.ts";
import type { DesignFiles } from "./services/design-files.ts";
import type { DesignMd } from "./services/design-md.ts";
import type { DesignSystemService } from "./services/design-system.ts";
import type { DesignTargets } from "./services/design-targets.ts";
import type { DocumentService } from "./services/documents.ts";
import type { EditService } from "./services/edit.ts";
import type { FigmaBaseline } from "./services/figma-baseline.ts";
import type { FigmaImportService } from "./services/figma-import.ts";
import { GitService } from "./services/git.ts";
import type { History } from "./services/history.ts";
import type { ImplementationService } from "./services/implementation.ts";
import type { PagePngs } from "./services/page-pngs.ts";
import type { PagesService } from "./services/pages.ts";
import { ProfileService } from "./services/profile.ts";
import { RepoPaths } from "./services/repo-paths.ts";
import type { Screenshots } from "./services/screenshots.ts";
import { SettingsService } from "./services/settings.ts";
import { SetupService } from "./services/setup.ts";
import type { SkillsService } from "./services/skills.ts";
import type { SnapshotStore } from "./services/snapshot-store.ts";
import { Storage } from "./services/storage.ts";
import type { ProjectStyleSystem } from "./services/style-system.ts";
import type { Thumbnails } from "./services/thumbnails.ts";
import type { WorkingTree } from "./services/working-tree.ts";

/** Everything that exists once a target repository is configured. */
export type ProjectServices =
  | CodeSide
  | CommentsService
  | ComponentService
  | DesignFiles
  | DesignMd
  | DesignSystemService
  | DesignTargets
  | DocumentService
  | EditService
  | FigmaBaseline
  | FigmaImportService
  | GitService
  | History
  | ImplementationService
  | PagePngs
  | ProjectStyleSystem
  | RepoPaths
  | PagesService
  | SkillsService
  | Thumbnails
  | WorkingTree;

/** What the services of an open project are built on: the server's own services. */
export type ProjectRequirements =
  | AppLog
  | ChildProcessSpawner.ChildProcessSpawner
  | EventBus
  | FileSystem.FileSystem
  | Path.Path
  | ProfileService
  | Screenshots
  | ServerConfig
  | SnapshotStore
  | Storage;

/** The services of the project the settings describe, as `composition.ts` builds them. */
type ProjectLayer = (
  settings: Settings
) => Layer.Layer<ProjectServices, never, ProjectRequirements>;

interface Opened {
  readonly scope: Scope.Closeable;
  readonly services: Context.Context<ProjectServices>;
  /** The settings it was opened with: the settings in force. */
  readonly settings: Settings;
}

const notConfigured = () =>
  new NotConfigured({ message: "no target repository configured" });

const equivalentSettings = Schema.toEquivalence(Settings);

/** A field left out of settings is the same as one set to nothing, as on the wire. */
const withoutUnset = (settings: Settings) =>
  Object.fromEntries(
    Object.entries(settings).filter(([, value]) => value !== undefined)
  ) as Settings;

/** Whether two settings run the same project: equal field by field, whatever their keys' order. */
const sameSettings = (a: Settings, b: Settings) =>
  equivalentSettings(withoutUnset(a), withoutUnset(b));

/**
 * The project open now, for whatever works against it: its services, and its scope for work that
 * must end when the project does. Two adapters: the one `ProjectManager` opens with the settings in
 * force, and the threads' tests' fixture, which opens only what threads use.
 */
export class OpenProject extends Context.Service<
  OpenProject,
  {
    /** Scope of the open project, for work that must end when the project does. */
    readonly scope: Effect.Effect<Scope.Scope, NotConfigured>;
    /**
     * One service of the open project, for a caller that asks it many things:
     * `const pages = project.service(PagesService)`, then `pages((p) => p.list)`.
     */
    readonly service: <I extends ProjectServices, S>(
      key: Context.Key<I, S>
    ) => <A, E>(
      f: (service: S) => Effect.Effect<A, E>
    ) => Effect.Effect<A, E | NotConfigured>;
    /** Runs an effect against the open project. */
    readonly use: <A, E>(
      effect: Effect.Effect<A, E, ProjectServices>
    ) => Effect.Effect<A, E | NotConfigured>;
  }
>()("ultrapaint/server/OpenProject") {}

/** What the setup changes of the detected settings, each repository-relative. */
export interface SetupChange {
  readonly designsDir?: string | undefined;
  readonly stylesheet?: string | undefined;
}

/** Where a setup was saved, and why it was not when `problems` says so. */
export interface SetupSaved {
  readonly configPath?: string;
  readonly problems: readonly string[];
}

/**
 * Owns the one open project and the settings in force. The project is a layer built into its
 * own scope: the file watcher and every agent session live there, so changing the settings or
 * shutting down closes all of them together.
 *
 * Whatever puts settings in force (a save, a configuration file saved or renamed, detection at
 * start, someone else's change to the file) comes through here, and one rule decides what
 * happens: the project is opened when none is, opened again when it runs other settings, and
 * left as it is when it runs these, its undo history with it. The editor is told of the
 * project's info whenever what it is made of changes: the settings and where they are kept, git,
 * the user's profile.
 */
export class ProjectManager extends Context.Service<
  ProjectManager,
  {
    /**
     * Opens the repository the server started in with the settings detection proposes, unless
     * someone set settings in the meantime: theirs win.
     */
    readonly adoptDetected: (repo: string) => Effect.Effect<void>;
    /**
     * Puts these settings in force: opens the project they describe, or opens it again when it
     * runs other settings, or leaves it be. `why` is what the log says of an opening.
     */
    readonly apply: (settings: Settings, why: string) => Effect.Effect<void>;
    readonly close: Effect.Effect<void>;
    readonly info: Effect.Effect<ProjectInfo>;
    /** Saves an unsaved session to a configuration file, and puts its settings in force. */
    readonly persist: (
      input: PersistInput
    ) => Effect.Effect<PersistResult, BadRequest | Conflict>;
    /** Renames a configuration file still under its old name; returns the new path. */
    readonly renameConfig: Effect.Effect<string, BadRequest | Conflict>;
    /**
     * Saves the setup of a folder opened for the first time (ADR 0062): the settings in force
     * with the designs directory and the stylesheet changed when given (a stylesheet `""` is
     * none), the designs directory made, and the settings written where they are kept, or to an
     * `ultrapaint.config.json` beside the code when they were detected and kept nowhere. Answers
     * with where they went and what is wrong with them.
     */
    readonly saveSetup: (change: SetupChange) => Effect.Effect<SetupSaved>;
    /** Validates and, when valid, saves the settings and puts them in force. */
    readonly set: (settings: Settings) => Effect.Effect<SettingsValidation>;
  }
>()("ultrapaint/server/ProjectManager") {
  /** The settings in force and the project they open: `ProjectManager` and `OpenProject`. */
  static readonly layer = (projectLayer: ProjectLayer) =>
    Layer.effectContext(
      Effect.gen(function* () {
        const requirements = yield* Effect.context<ProjectRequirements>();
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const events = yield* EventBus;
        const log = yield* AppLog;
        const storage = yield* Storage;
        const settingsService = yield* SettingsService;
        const setup = yield* SetupService;
        const profile = yield* ProfileService;
        const managerScope = yield* Effect.scope;
        // open and close never interleave.
        const lifecycle = yield* Semaphore.make(1);
        // What is in force is decided by one caller at a time: a save made while detection
        // reads the repository lands before or after the detected settings, never between.
        const inForce = yield* Semaphore.make(1);
        const publishing = yield* Semaphore.make(1);
        let current: Opened | null = null;
        /**
         * How many openings are under way. Whatever asks for the open project while there is none
         * waits for them (`OpenProject`): a server started for an agent outside the editor is
         * asked before it has opened its project (ADR 0083), and the answer is the project, not
         * that none is open.
         */
        const opening = yield* SubscriptionRef.make(0);
        const counted = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          Effect.acquireUseRelease(
            SubscriptionRef.update(opening, (n) => n + 1),
            () => effect,
            () => SubscriptionRef.update(opening, (n) => n - 1)
          );
        const settled = SubscriptionRef.changes(opening).pipe(
          Stream.filter((n) => n === 0),
          Stream.runHead,
          Effect.asVoid
        );
        const scopeNow = Effect.suspend(() =>
          current ? Effect.succeed(current.scope) : Effect.fail(notConfigured())
        );
        /** The open project's services, once any opening under way has ended. */
        const useOnceOpened = <A, E>(
          effect: Effect.Effect<A, E, ProjectServices>
        ): Effect.Effect<A, E | NotConfigured> =>
          Effect.suspend(() =>
            current ? use(effect) : Effect.andThen(settled, use(effect))
          );
        // The info the editor was last told, to tell it only of a change.
        let published: string | null = null;

        const use = <A, E>(
          effect: Effect.Effect<A, E, ProjectServices>
        ): Effect.Effect<A, E | NotConfigured> =>
          Effect.suspend(
            (): Effect.Effect<A, E | NotConfigured> =>
              current
                ? Effect.provideContext(effect, current.services)
                : Effect.fail(notConfigured())
          );

        const openInfo = use(
          Effect.gen(function* () {
            const paths = yield* RepoPaths;
            const git = yield* GitService;
            const gitRepository = yield* git.repository;
            return {
              // A detached HEAD or a broken git must not hide the rest of the project.
              branch: gitRepository
                ? yield* Effect.orElseSucceed(git.branch, () => "")
                : "",
              configured: true,
              designsDir: paths.settings.designsDir,
              gitRepository,
              gitUser: yield* git.user,
              name: path.basename(paths.root),
              repoPath: paths.root,
              setup: (yield* settingsService.detected)
                ? ("detected" as const)
                : ("saved" as const),
            };
          })
        ).pipe(
          Effect.orElseSucceed(() => ({
            configured: false,
          }))
        );
        const info: Effect.Effect<ProjectInfo> = Effect.gen(function* () {
          const { displayName } = yield* profile.get;
          const settings = yield* settingsService.get;
          return {
            ...(yield* openInfo),
            ...(displayName === undefined ? {} : { displayName }),
            ...(settings === null ? {} : { settings }),
            storage: yield* storage.info,
          };
        });

        /** Tells the editor the project's info, when it is not what it was last told. */
        const publishInfo = publishing.withPermits(1)(
          Effect.gen(function* () {
            const value = yield* info;
            const text = JSON.stringify(value);
            if (text === published) {
              return;
            }
            published = text;
            yield* events.publish("project", value);
          })
        );

        const closeCurrent = Effect.suspend(() => {
          const open = current;
          current = null;
          return open ? Scope.close(open.scope, Exit.void) : Effect.void;
        });

        const open = (settings: Settings) =>
          lifecycle
            .withPermits(1)(
              Effect.gen(function* () {
                yield* closeCurrent;
                const scope = yield* Scope.fork(managerScope);
                const services = yield* Layer.buildWithScope(
                  projectLayer(settings),
                  scope
                ).pipe(
                  Effect.provideContext(requirements),
                  Effect.onError(() => Scope.close(scope, Exit.void))
                );
                current = { scope, services, settings };
              })
            )
            .pipe(
              // A repository that moved or vanished leaves the server running and unconfigured,
              // and the editor is told so.
              Effect.catchCause((cause) =>
                Effect.andThen(
                  log.log(
                    "server",
                    "error",
                    `could not open ${settings.repoPath}: ${String(cause)}`
                  ),
                  publishInfo
                )
              ),
              // The old project is already closed by the time the new one is built; a caller that
              // goes away in between must not leave the server with neither.
              (effect) =>
                Effect.flatMap(Effect.forkIn(effect, managerScope), Fiber.join),
              counted,
              Effect.withSpan("ProjectManager.open")
            );

        /** The one rule: open when nothing runs these settings, else only say what changed. */
        const putInForce = Effect.fnUntraced(function* (
          settings: Settings,
          why: string
        ) {
          if (!(current && sameSettings(current.settings, settings))) {
            yield* log.log(
              "server",
              "info",
              `opening ${settings.repoPath}: ${why}`
            );
            yield* open(settings);
          }
          // The settings, where they are kept, or whose they are may have changed.
          yield* publishInfo;
        });

        const apply = (settings: Settings, why: string) =>
          inForce
            .withPermits(1)(putInForce(settings, why))
            .pipe(counted, Effect.withSpan("ProjectManager.apply"));

        const set = Effect.fn("ProjectManager.set")(function* (
          settings: Settings
        ) {
          return yield* inForce.withPermits(1)(
            Effect.gen(function* () {
              const validation = yield* settingsService.set(settings);
              const saved = yield* settingsService.get;
              if (validation.ok && saved) {
                yield* putInForce(saved, "settings saved");
              }
              return validation;
            })
          );
        });

        const persist = Effect.fn("ProjectManager.persist")(function* (
          input: PersistInput
        ) {
          return yield* inForce.withPermits(1)(
            Effect.gen(function* () {
              const result = yield* settingsService.persist(input);
              const saved = yield* settingsService.get;
              if (result.validation.ok && saved) {
                yield* putInForce(saved, "settings saved to a file");
              }
              return result;
            })
          );
        });

        /** Settings saved where they are kept, or to a new configuration file beside the code. */
        const saveSettings = Effect.fnUntraced(function* (next: Settings) {
          const target = yield* storage.target;
          if (target.mode !== "ephemeral") {
            const validation = yield* set(next);
            return {
              ...(target.mode === "file" && { configPath: target.configPath }),
              problems: validation.problems,
            };
          }
          return yield* persist({
            configPath: path.join(next.repoPath, CONFIG_FILE_NAME),
            settings: next,
          }).pipe(
            Effect.map((result) => ({
              ...(result.configPath !== undefined && {
                configPath: result.configPath,
              }),
              problems: result.validation.problems,
            })),
            Effect.catch((error) =>
              Effect.succeed({ problems: [error.message] })
            )
          );
        });

        const saveSetup = Effect.fn("ProjectManager.saveSetup")(function* (
          change: SetupChange
        ) {
          const settings = yield* settingsService.get;
          if (!settings) {
            return { problems: ["no folder is open to set up"] };
          }
          const designsDir = change.designsDir?.trim() || settings.designsDir;
          const [css] = settings.hostCss;
          const stylesheet =
            change.stylesheet?.trim() ??
            (css === undefined ? "" : stylesheetOf(settings.designsDir, css));
          const next: Settings = {
            ...settings,
            designsDir,
            hostCss: stylesheet ? [hostCssFor(designsDir, stylesheet)] : [],
          };
          const made = yield* setup
            .createDesigns({ designsDir, repoPath: settings.repoPath })
            .pipe(
              Effect.as([] as readonly string[]),
              Effect.catch((error) => Effect.succeed([error.message]))
            );
          if (made.length > 0) {
            return { problems: made };
          }
          const saved = yield* saveSettings(next);
          // The directory detection made, left empty, goes once the setup chose another and
          // the project opened there; one that cannot be removed is only left behind.
          if (
            saved.problems.length === 0 &&
            designsDir !== settings.designsDir
          ) {
            const before = path.join(settings.repoPath, settings.designsDir);
            yield* fs.readDirectory(before).pipe(
              Effect.flatMap((entries) =>
                entries.length === 0
                  ? fs.remove(before, { recursive: true })
                  : Effect.void
              ),
              Effect.ignore
            );
          }
          return saved;
        });

        const renameConfig = inForce
          .withPermits(1)(Effect.tap(settingsService.renameConfig, publishInfo))
          .pipe(Effect.withSpan("ProjectManager.renameConfig"));

        const adoptDetected = Effect.fn("ProjectManager.adoptDetected")(
          function* (repo: string) {
            const found = yield* setup.detect(repo).pipe(
              // A repository that cannot be read is left for the setup to ask about.
              Effect.catchTag("BadRequest", (error) =>
                Effect.as(
                  log.log(
                    "server",
                    "warn",
                    `could not detect ${repo}: ${error.message}`
                  ),
                  null
                )
              )
            );
            if (!found) {
              return;
            }
            const candidate = applySuggestions(defaultSettings(repo), found);
            // An application opened for the first time has nowhere for its designs yet: the
            // directory is made empty, so the project opens and its setup chat can run (ADR
            // 0062), which keeps it or chooses another. A folder holding no app is left as it is.
            if (found.anchors.length > 0 && found.designsDirs.length === 0) {
              yield* setup
                .createDesigns({
                  designsDir: candidate.designsDir,
                  repoPath: repo,
                })
                .pipe(
                  Effect.catch((error) =>
                    log.log(
                      "server",
                      "warn",
                      `could not make ${candidate.designsDir}: ${error.message}`
                    )
                  )
                );
            }
            yield* inForce.withPermits(1)(
              Effect.gen(function* () {
                // Settings someone set while the repository was read are in force already.
                if (yield* settingsService.get) {
                  return;
                }
                const validation = yield* settingsService.adopt(candidate);
                const adopted = yield* settingsService.get;
                if (!(validation.ok && adopted)) {
                  return yield* log.log(
                    "server",
                    "info",
                    `${repo} needs setting up: ${validation.problems.join(" ")}`
                  );
                }
                yield* log.log(
                  "server",
                  "info",
                  `opened ${repo} with detected settings; save them to keep them`
                );
                yield* putInForce(adopted, "detected settings");
              })
            );
          },
          // A detection that opens the project is an opening too.
          counted
        );

        // The configuration file changed under us (an editor, a branch switch), or one appeared
        // for an unsaved session: follow it. The user's profile is part of the info. Started at
        // once, each has subscribed by the time the layer is built.
        yield* settingsService.changes.pipe(
          Stream.runForEach((next) =>
            apply(next, "the configuration file changed")
          ),
          Effect.forkIn(managerScope, { startImmediately: true })
        );
        yield* profile.changes.pipe(
          Stream.runForEach(() => publishInfo),
          Effect.forkIn(managerScope, { startImmediately: true })
        );

        return Context.make(
          ProjectManager,
          ProjectManager.of({
            adoptDetected,
            apply,
            close: lifecycle.withPermits(1)(closeCurrent),
            info,
            persist,
            renameConfig,
            saveSetup,
            set,
          })
        ).pipe(
          Context.add(
            OpenProject,
            OpenProject.of({
              scope: Effect.suspend(() =>
                current ? scopeNow : Effect.andThen(settled, scopeNow)
              ),
              service: (key) => (f) => useOnceOpened(Effect.flatMap(key, f)),
              use: useOnceOpened,
            })
          )
        );
      })
    );
}
