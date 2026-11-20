/**
 * The app's projects (PLAN-desktop D2): `projects.json` in the app's data directory. A project is
 * a name and either a local folder (`local`) or a folder on another machine reached over SSH
 * (`ssh`): a host as `ssh` takes it, a path there, and the command that runs the server there.
 * The file keeps the open tabs too, in their order, and the one shown (ADR 0107). The list is the
 * app's own: nothing is written in the projects' folders.
 */

import { OpeningTimes } from "@ultrapaint/contracts/opening";
import { ShownProjectIcon } from "@ultrapaint/contracts/project";
import type { ProjectLook } from "@ultrapaint/contracts/shell-bridge";
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
import { sameValue } from "./changes.ts";
import { StoreError, UnknownProject } from "./errors.ts";
import { parseHostInput } from "./ssh-hosts.ts";

const LocalProject = Schema.Struct({
  /** Its icon as its server last showed it (ADR 0107): the list draws it until it opens again. */
  icon: Schema.optional(ShownProjectIcon),
  id: Schema.String,
  kind: Schema.Literal("local"),
  /** When it was last opened, in milliseconds since the epoch; never, when absent. */
  lastOpened: Schema.optional(Schema.Number),
  /** How long each step of its last open took: the next open's estimate (ADR 0099). */
  lastOpening: Schema.optional(OpeningTimes),
  name: Schema.String,
  /** The folder, absolute. */
  path: Schema.String,
});

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
  icon: Schema.optional(ShownProjectIcon),
  id: Schema.String,
  kind: Schema.Literal("ssh"),
  lastOpened: Schema.optional(Schema.Number),
  lastOpening: Schema.optional(OpeningTimes),
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

/**
 * A project as its server shows it (ADR 0107): its name, and its icon, or none for the default.
 */
export const withLook = (project: Project, look: ProjectLook): Project => {
  const { icon: _was, ...rest } = project;
  return {
    ...rest,
    ...(look.icon === undefined ? {} : { icon: look.icon }),
    name: look.name,
  };
};

/** Where a project is, for the lists: its folder, or `host:path`. */
export const projectDetail = (project: Project) =>
  project.kind === "local"
    ? project.path
    : `${project.host}${project.port === undefined ? "" : `:${project.port}`}:${project.path}`;

/** A remote path without the slashes that make it differ from the same path: `/a/b/` is `/a/b`. */
const TRAILING_SLASHES_RE = /(?<=.)\/+$/;
const normalizeRemotePath = (path: string) =>
  path.trim().replace(TRAILING_SLASHES_RE, "");

/** The last part of a remote path, for the project's name. */
const lastSegment = (path: string) =>
  path
    .split("/")
    .filter((part) => part !== "" && part !== "~")
    .at(-1);

/** The tabs open over the window (ADR 0107), as the next start brings them back. */
export interface OpenTabs {
  /** The open projects' ids, in the order their tabs were opened. */
  readonly open: readonly string[];
  /** The one shown; null for Home. */
  readonly shown: string | null;
}

const ProjectsFile = Schema.fromJsonString(
  Schema.Struct({
    /** Absent from a file of before the tabs: its `last` project is the one tab (ADR 0107). */
    open: Schema.optional(Schema.Array(Schema.String)),
    projects: Schema.Array(Project),
    shown: Schema.optional(Schema.NullOr(Schema.String)),
    version: Schema.Literal(1),
  })
);
type ProjectsFile = typeof ProjectsFile.Type;
const decodeFile = Schema.decodeUnknownEffect(ProjectsFile);
const encodeFile = Schema.encodeEffect(ProjectsFile);

export const PROJECTS_FILE = "projects.json";

/** The most recently opened project first; one never opened after every one that was. */
const byLastOpened = (projects: readonly Project[]): Project[] =>
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
     * the list already; a command given there replaces the one it had, and an empty one puts
     * the default back.
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
    /**
     * Keeps how long the steps of the project's open took, over the times its last open kept for
     * them: the shell's steps first, the editor's once it is ready.
     */
    readonly timed: (
      id: string,
      times: OpeningTimes
    ) => Effect.Effect<void, StoreError>;
    /**
     * Takes the project off the list; nothing when it is not there. The list alone: what the
     * app keeps for the project besides is `OpenProjects.remove`'s, and its folder no one's.
     */
    readonly remove: (id: string) => Effect.Effect<void, StoreError>;
    /**
     * Keeps the name and icon the project's server shows (ADR 0107), which the list and its tab
     * show from then on; nothing when it is not in the list.
     */
    readonly describe: (
      id: string,
      look: ProjectLook
    ) => Effect.Effect<void, StoreError>;
    /**
     * The tabs open when the app last ran, those still in the list: a file of before the tabs
     * opens its last project as the one tab, shown (ADR 0107).
     */
    readonly tabs: Effect.Effect<OpenTabs, StoreError>;
    /** Keeps the tabs open and the one shown, for the next start. */
    readonly setTabs: (tabs: OpenTabs) => Effect.Effect<void, StoreError>;
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

        const readFile = Effect.gen(function* () {
          if (!(yield* fs.exists(file))) {
            return { projects: [], version: 1 } as ProjectsFile;
          }
          const text = yield* fs.readFileString(file);
          return yield* decodeFile(text);
        }).pipe(
          // An unreadable list is not replaced by an empty one: it may only need mending.
          Effect.mapError(storeError("the project list could not be read from"))
        );
        const read = Effect.map(readFile, (kept) => kept.projects);

        /** Writes the file, its tabs as they are unless given. */
        const writeFile = (next: ProjectsFile) =>
          encodeFile(next).pipe(
            Effect.flatMap((text) => writeAtomic(file, `${text}\n`)),
            Effect.mapError(
              storeError("the project list could not be written to")
            ),
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path)
          );

        /** Writes the projects, the tabs kept as they are, but for a project gone from the list. */
        const write = (projects: readonly Project[]) =>
          Effect.flatMap(readFile, (kept) => {
            const ids = new Set(projects.map((p) => p.id));
            return writeFile({
              ...kept,
              ...(kept.open === undefined
                ? {}
                : { open: kept.open.filter((id) => ids.has(id)) }),
              ...(kept.shown && !ids.has(kept.shown) ? { shown: null } : {}),
              projects,
              version: 1,
            });
          });

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
            // Not given, it stays; given empty, it is the default again.
            if (input.command === undefined || command === known.command) {
              return known;
            }
            const { command: _was, ...rest } = known;
            const changed: SshProject =
              command === undefined ? rest : { ...rest, command };
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

        const timed = Effect.fn("ProjectStore.timed")(function* (
          id: string,
          times: OpeningTimes
        ) {
          const projects = yield* read;
          yield* write(
            projects.map((p) =>
              p.id === id
                ? { ...p, lastOpening: { ...p.lastOpening, ...times } }
                : p
            )
          );
        }, lock.withPermits(1));

        const remove = Effect.fn("ProjectStore.remove")(function* (id: string) {
          const projects = yield* read;
          if (projects.some((p) => p.id === id)) {
            yield* write(projects.filter((p) => p.id !== id));
          }
        }, lock.withPermits(1));

        const lastOf = (projects: readonly Project[]) =>
          Option.fromNullishOr(
            byLastOpened(projects).find((p) => p.lastOpened !== undefined)
          );

        const describe = Effect.fn("ProjectStore.describe")(function* (
          id: string,
          look: ProjectLook
        ) {
          const projects = yield* read;
          const known = projects.find((p) => p.id === id);
          if (
            !known ||
            (known.name === look.name && sameValue(known.icon, look.icon))
          ) {
            return;
          }
          yield* write(
            projects.map((p) => (p.id === id ? withLook(p, look) : p))
          );
        }, lock.withPermits(1));

        const tabs = Effect.map(readFile, (kept): OpenTabs => {
          const ids = new Set(kept.projects.map((p) => p.id));
          if (kept.open === undefined) {
            const last = Option.getOrUndefined(lastOf(kept.projects));
            return last
              ? { open: [last.id], shown: last.id }
              : { open: [], shown: null };
          }
          const open = kept.open.filter((id) => ids.has(id));
          const shown = kept.shown ?? null;
          return {
            open,
            shown: shown !== null && open.includes(shown) ? shown : null,
          };
        });

        const setTabs = Effect.fn("ProjectStore.setTabs")(function* (
          next: OpenTabs
        ) {
          const kept = yield* readFile;
          yield* writeFile({
            ...kept,
            open: [...next.open],
            shown: next.shown,
          });
        }, lock.withPermits(1));

        return ProjectStore.of({
          add,
          addRemote,
          describe,
          get,
          last: Effect.map(read, lastOf),
          list: Effect.map(read, (projects) =>
            [...projects].sort((a, b) => a.name.localeCompare(b.name))
          ),
          opened,
          remove,
          setTabs,
          tabs,
          timed,
        });
      })
    );
}
