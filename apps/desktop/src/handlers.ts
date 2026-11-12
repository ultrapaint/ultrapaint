/**
 * How the main process answers each capability of the shell bridge the page calls
 * (`@ultrapaint/contracts/shell-bridge`): one Effect per capability, over the app's services,
 * given its input already decoded and giving its output to be encoded (`bridge-server.ts`). Nothing
 * of Electron: the dialogs go through `Shell`, so the handlers run in tests on `fakeShell` and the
 * services' test layers.
 */
import { BUILT_IN_AGENTS } from "@ultrapaint/acp/built-in";
import { CONFIG_FILE_NAMES } from "@ultrapaint/contracts/settings";
import type {
  FirstPrompt,
  FolderKind,
} from "@ultrapaint/contracts/shell-bridge";
import {
  type BuiltInAgentId,
  ChatPreferencesFile,
} from "@ultrapaint/contracts/threads";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { AgentSettings } from "./agent-settings.ts";
import { Agents } from "./agents.ts";
import type { BridgeHandlers } from "./bridge-server.ts";
import { CommandLine } from "./command-line.ts";
import { NewDesigns } from "./new-design.ts";
import { Notices } from "./notices.ts";
import { OpenProject } from "./open-project.ts";
import { ProjectStore, projectDetail, remoteInputOf } from "./projects.ts";
import { Shell } from "./shell.ts";
import { readSshHosts } from "./ssh-hosts.ts";

/** What the handlers need besides the app's services. */
interface HandlerOptions {
  /** The user's home directory, which `~` in the SSH configuration names. */
  readonly home: string;
  /**
   * Restarts the app into its update (ADR 0078): the window's own business, as a quit is, so
   * the main process gives it. Nothing without.
   */
  readonly installUpdate?: Effect.Effect<void>;
  /** The SSH configuration whose hosts are suggested. */
  readonly sshConfig: string;
}

/** What the handlers run on. */
export type HandlerServices =
  | AgentSettings
  | Agents
  | CommandLine
  | FileSystem.FileSystem
  | NewDesigns
  | Notices
  | OpenProject
  | Path.Path
  | ProjectStore
  | Shell;

const decodePreferences = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ChatPreferencesFile)
);

/**
 * What the chat remembers, from the user's directory (`~/.ultrapaint/chat/preferences.json`,
 * the server's `ChatPreferences`): nothing when no chat has run on this machine yet, or the file
 * cannot be read.
 */
const chatPreferences = (home: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const text = yield* fs.readFileString(
      path.join(home, ".ultrapaint", "chat", "preferences.json")
    );
    return yield* decodePreferences(text);
  }).pipe(
    Effect.orElseSucceed(
      (): ChatPreferencesFile => ({ agents: [], defaults: {} })
    )
  );

/** What a folder may hold and still count as empty: what a system or `git init` leaves. */
const LEFT_BY_OTHERS = new Set([".DS_Store", "Thumbs.db", ".git"]);

/** What a folder holds, for the start screen: a folder that cannot be read counts as one. */
const inspectFolder = (folder: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const name = path.basename(folder);
    const there = yield* fs
      .readDirectory(folder)
      .pipe(Effect.orElseSucceed((): string[] => []));
    if (CONFIG_FILE_NAMES.some((file) => there.includes(file))) {
      return { kind: "project", name } satisfies FolderKind;
    }
    const empty = there.every((entry) => LEFT_BY_OTHERS.has(entry));
    return { kind: empty ? "empty" : "folder", name } satisfies FolderKind;
  });

/** Whether the open project's server runs on another machine: it hides this machine's own. */
export const remoteOpen = Effect.map(
  OpenProject.use((o) => o.current),
  (current) => Option.isSome(current) && current.value.kind === "ssh"
);

/** A change to an agent, applied by starting the project's server again. */
const thenRestart = <A, E, R>(change: Effect.Effect<A, E, R>) =>
  Effect.andThen(
    change,
    OpenProject.use((o) => o.restart)
  );

/** Where the agent's executable is: the one picked, or the PATH's with `undefined`. */
const setAgentPath = (id: BuiltInAgentId, executable: string | undefined) =>
  thenRestart(
    AgentSettings.use((s) =>
      s.update(id, (setting) => ({ ...setting, path: executable }))
    )
  );

export const bridgeHandlers = (
  options: HandlerOptions
): BridgeHandlers<HandlerServices> => ({
  "agents.choosePath": (id) =>
    Effect.gen(function* () {
      const shell = yield* Shell;
      const picked = yield* shell.pickFile(
        `Where is ${BUILT_IN_AGENTS[id].name}?`
      );
      if (Option.isSome(picked)) {
        yield* setAgentPath(id, picked.value);
      }
    }),
  "agents.clearPath": (id) => setAgentPath(id, undefined),
  "agents.download": (id) => thenRestart(Agents.use((a) => a.download(id))),
  "agents.list": () => Agents.use((a) => a.status),
  "agents.preferences": () => chatPreferences(options.home),
  "agents.setApiKey": (id, key) =>
    thenRestart(
      Agents.use((a) => a.setApiKey(id, key?.trim() ? key : undefined))
    ),
  // The agent keeps its sign-in itself: nothing to start again.
  "agents.signIn": (id) => Agents.use((a) => a.signIn(id)),
  "command.install": () => CommandLine.use((c) => c.install),
  "command.installed": () => CommandLine.use((c) => c.installed),
  installUpdate: () => options.installUpdate ?? Effect.void,
  "newDesign.create": (input, report) =>
    NewDesigns.use((n) => n.create(input, report)),
  "newDesign.folderFor": (name) => NewDesigns.use((n) => n.folderFor(name)),
  notices: () => Notices.use((n) => n.list),
  pickFolder: (picker) =>
    Effect.map(
      Shell.use((s) =>
        s.pickFolder({
          defaultPath: picker?.defaultPath,
          title: picker?.title ?? "Choose a folder",
        })
      ),
      Option.getOrNull
    ),
  "projects.add": () => Effect.asVoid(OpenProject.use((o) => o.add)),
  /**
   * What is wrong with the fields comes back to the dialog; a project that does not open shows
   * why on the welcome page, as any project does.
   */
  "projects.addRemote": (request) => {
    const checked = remoteInputOf(request);
    return "problem" in checked
      ? Effect.succeed({ problem: checked.problem })
      : Effect.as(
          Effect.ignore(OpenProject.use((o) => o.addRemote(checked.input))),
          {}
        );
  },
  "projects.current": () =>
    Effect.map(
      OpenProject.use((o) => o.current),
      (current) => Option.getOrNull(current)?.id ?? null
    ),
  "projects.inspect": (folder) => inspectFolder(folder),
  "projects.list": () =>
    Effect.gen(function* () {
      const open = yield* OpenProject;
      const projects = yield* ProjectStore.use((store) => store.list);
      return yield* Effect.forEach(projects, (p) =>
        Effect.map(open.unsaved(p), (unsaved) => ({
          detail: projectDetail(p),
          id: p.id,
          name: p.name,
          unsaved,
        }))
      );
    }),
  "projects.open": (id) => OpenProject.use((o) => o.open(id)),
  "projects.openFolder": (folder, start?: FirstPrompt) =>
    Effect.asVoid(
      OpenProject.use((o) => o.openFolder(folder, undefined, start))
    ),
  "projects.remove": (id) => OpenProject.use((o) => o.remove(id)),
  "projects.showStart": () => OpenProject.use((o) => o.showStart),
  "projects.sshHosts": () => readSshHosts(options.sshConfig, options.home),
  "projects.stopOpening": () => OpenProject.use((o) => o.stopOpening),
  "projects.takeFirstPrompt": () => OpenProject.use((o) => o.takeFirstPrompt),
});
