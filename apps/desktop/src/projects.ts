/**
 * The app's projects (PLAN-desktop D2): `projects.json` in the app's data directory. A project is
 * a name and a local folder for now; a host and a path on it come with SSH (Phase 3), as another
 * `kind`. The list is the app's own: nothing is written in the projects' folders.
 */
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Random,
  Schema,
  Semaphore,
} from "effect";
import { writeAtomic } from "./atomic-write.ts";
import { StoreError, UnknownProject } from "./errors.ts";

export const LocalProject = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("local"),
  /** When it was last opened, in milliseconds since the epoch; never, when absent. */
  lastOpened: Schema.optional(Schema.Number),
  name: Schema.String,
  /** The folder, absolute. */
  path: Schema.String,
});
export type LocalProject = typeof LocalProject.Type;

/** A project in the list. Only local folders so far. */
export const Project = LocalProject;
export type Project = typeof Project.Type;

const ProjectsFile = Schema.fromJsonString(
  Schema.Struct({
    projects: Schema.Array(Project),
    version: Schema.Literal(1),
  })
);
const decodeFile = Schema.decodeUnknownEffect(ProjectsFile);
const encodeFile = Schema.encodeEffect(ProjectsFile);

export const PROJECTS_FILE = "projects.json";

/** The most recently opened project first; one never opened after every one that was. */
export const byLastOpened = (projects: readonly Project[]): Project[] =>
  [...projects].sort((a, b) => (b.lastOpened ?? -1) - (a.lastOpened ?? -1));

export class ProjectStore extends Context.Service<
  ProjectStore,
  {
    /**
     * Adds a folder, under `name` or the folder's own, or finds it when it is in the list
     * already.
     */
    readonly add: (
      folder: string,
      name?: string
    ) => Effect.Effect<Project, StoreError>;
    readonly get: (
      id: string
    ) => Effect.Effect<Project, StoreError | UnknownProject>;
    /** The one opened last, which the app opens when it starts. */
    readonly last: Effect.Effect<Option.Option<Project>, StoreError>;
    /** In the order the switcher lists them: by name. */
    readonly list: Effect.Effect<readonly Project[], StoreError>;
    /** Notes that the project was opened now. */
    readonly opened: (id: string) => Effect.Effect<void, StoreError>;
  }
>()("ultrapaint/desktop/ProjectStore") {
  /** The list in `dir`, the app's data directory. */
  static readonly layer = (dir: string) =>
    Layer.effect(
      ProjectStore,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const file = path.join(dir, PROJECTS_FILE);
        // One change at a time: each reads the list, changes it and writes it back.
        const lock = yield* Semaphore.make(1);
        const storeError = (what: string) => (error: { message: string }) =>
          new StoreError({
            message: `${what} ${file}: ${error.message}`,
          });

        const read = Effect.gen(function* () {
          if (!(yield* fs.exists(file))) {
            return [] as readonly Project[];
          }
          const text = yield* fs.readFileString(file);
          return (yield* decodeFile(text)).projects;
        }).pipe(
          // An unreadable list is not replaced by an empty one: it may only need mending.
          Effect.mapError(storeError("the project list could not be read from"))
        );

        const write = (projects: readonly Project[]) =>
          encodeFile({ projects, version: 1 }).pipe(
            Effect.flatMap((text) => writeAtomic(file, `${text}\n`)),
            Effect.mapError(
              storeError("the project list could not be written to")
            ),
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path)
          );

        const get = Effect.fn("ProjectStore.get")(function* (id: string) {
          const found = (yield* read).find((p) => p.id === id);
          return found ?? (yield* new UnknownProject({ id }));
        });

        const add = Effect.fn("ProjectStore.add")(function* (
          folder: string,
          name?: string
        ) {
          const absolute = path.resolve(folder);
          const projects = yield* read;
          const known = projects.find((p) => p.path === absolute);
          if (known) {
            return known;
          }
          const id = (yield* Random.nextIntBetween(0, 2 ** 48)).toString(36);
          const project: Project = {
            id,
            kind: "local",
            name: name?.trim() || path.basename(absolute) || absolute,
            path: absolute,
          };
          yield* write([...projects, project]);
          return project;
        }, lock.withPermits(1));

        const opened = Effect.fn("ProjectStore.opened")(function* (id: string) {
          const now = yield* Clock.currentTimeMillis;
          const projects = yield* read;
          yield* write(
            projects.map((p) => (p.id === id ? { ...p, lastOpened: now } : p))
          );
        }, lock.withPermits(1));

        return ProjectStore.of({
          add,
          get,
          last: Effect.map(read, (projects) =>
            Option.fromNullishOr(
              byLastOpened(projects).find((p) => p.lastOpened !== undefined)
            )
          ),
          list: Effect.map(read, (projects) =>
            [...projects].sort((a, b) => a.name.localeCompare(b.name))
          ),
          opened,
        });
      })
    );
}
