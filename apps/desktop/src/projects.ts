/**
 * The app's projects (PLAN-desktop D2): `projects.json` in the app's data directory. A project is
 * a name and either a local folder (`local`) or a folder on another machine reached over SSH
 * (`ssh`): a host as `ssh` takes it, a path there, and the command that runs the server there.
 * The list is the app's own: nothing is written in the projects' folders.
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
import { parseHostInput } from "./ssh-hosts.ts";

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

/** The command that runs the server on the remote machine, unless the project names another. */
export const DEFAULT_REMOTE_COMMAND = "ultrapaint";

export const SshProject = Schema.Struct({
  /**
   * What runs the server there, before the flags the app adds: `ultrapaint` by default, or
   * `node /path/to/ultrapaint/scripts/cli.ts`, say. Shell syntax, run by the login shell.
   */
  command: Schema.optional(Schema.String),
  /** A `Host` alias of the SSH configuration, a host name, or `user@host`. */
  host: Schema.String,
  id: Schema.String,
  kind: Schema.Literal("ssh"),
  lastOpened: Schema.optional(Schema.Number),
  name: Schema.String,
  /** The folder on the remote machine: absolute, or under its home as `~/…`. */
  path: Schema.String,
  /** A port other than the configuration's (or 22). */
  port: Schema.optional(Schema.Int),
});
export type SshProject = typeof SshProject.Type;

/** A project in the list: a local folder, or a folder on another machine over SSH. */
export const Project = Schema.Union([LocalProject, SshProject]);
export type Project = typeof Project.Type;

/** What a remote project is added with: the dialog's fields. */
export interface RemoteProjectInput {
  readonly command?: string | undefined;
  readonly host: string;
  readonly name?: string | undefined;
  readonly path: string;
  readonly port?: number | undefined;
}

/**
 * The dialog's fields as a remote project, or what is wrong with them: a host `ssh` takes, and a
 * path that is absolute or under the home directory.
 */
export const remoteInputOf = (fields: {
  readonly command?: string | undefined;
  readonly host: string;
  readonly path: string;
}): { readonly input: RemoteProjectInput } | { readonly problem: string } => {
  const host = parseHostInput(fields.host);
  if (!host) {
    return {
      problem: `${fields.host.trim() || "An empty host"} is not a host: an alias of your SSH configuration, a host name, user@host or user@host:port`,
    };
  }
  const path = normalizeRemotePath(fields.path);
  if (!(path.startsWith("/") || path === "~" || path.startsWith("~/"))) {
    return {
      problem: `${path || "An empty path"} is not a folder's full path on ${host.host}: start it with / or ~/`,
    };
  }
  return { input: { ...host, command: fields.command, path } };
};

/** Where a project is, for the switcher: its folder, or `host:path`. */
export const projectDetail = (project: Project) =>
  project.kind === "local"
    ? project.path
    : `${project.host}${project.port === undefined ? "" : `:${project.port}`}:${project.path}`;

/** A remote path without the slashes that make it differ from the same path: `/a/b/` is `/a/b`. */
const TRAILING_SLASHES_RE = /(?<=.)\/+$/;
export const normalizeRemotePath = (path: string) =>
  path.trim().replace(TRAILING_SLASHES_RE, "");

/** The last part of a remote path, for the project's name. */
const lastSegment = (path: string) =>
  path
    .split("/")
    .filter((part) => part !== "" && part !== "~")
    .at(-1);

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
    /**
     * Adds a folder on another machine, or finds it when the same host, port and path are in
     * the list already; a command given there replaces the one it had.
     */
    readonly addRemote: (
      input: RemoteProjectInput
    ) => Effect.Effect<SshProject, StoreError>;
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

        const newId = Effect.map(Random.nextIntBetween(0, 2 ** 48), (n) =>
          n.toString(36)
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
          const known = projects.find(
            (p) => p.kind === "local" && p.path === absolute
          );
          if (known) {
            return known;
          }
          const project: Project = {
            id: yield* newId,
            kind: "local",
            name: name?.trim() || path.basename(absolute) || absolute,
            path: absolute,
          };
          yield* write([...projects, project]);
          return project;
        }, lock.withPermits(1));

        const addRemote = Effect.fn("ProjectStore.addRemote")(function* (
          input: RemoteProjectInput
        ) {
          const host = input.host.trim();
          const remotePath = normalizeRemotePath(input.path);
          const command = input.command?.trim() || undefined;
          const projects = yield* read;
          const known = projects.find(
            (p): p is SshProject =>
              p.kind === "ssh" &&
              p.host === host &&
              p.port === input.port &&
              p.path === remotePath
          );
          if (known) {
            if (command === undefined || command === known.command) {
              return known;
            }
            const changed: SshProject = { ...known, command };
            yield* write(
              projects.map((p) => (p.id === known.id ? changed : p))
            );
            return changed;
          }
          const project: SshProject = {
            ...(command === undefined ? {} : { command }),
            host,
            id: yield* newId,
            kind: "ssh",
            name: input.name?.trim() || lastSegment(remotePath) || host,
            path: remotePath,
            ...(input.port === undefined ? {} : { port: input.port }),
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
          addRemote,
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
