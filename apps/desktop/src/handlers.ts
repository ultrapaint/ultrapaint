/**
 * How the main process answers each capability of the shell bridge the page calls
 * (`@ultrapaint/contracts/shell-bridge`): one Effect per capability, over the app's services,
 * given its input already decoded and giving its output to be encoded (`bridge-server.ts`). Nothing
 * of Electron: the dialogs go through `Shell`, so the handlers run in tests on `fakeShell` and the
 * services' test layers.
 */
import { BUILT_IN_AGENTS } from "@ultrapaint/acp/built-in";
import type { BuiltInAgentId } from "@ultrapaint/contracts/threads";
import { Effect, type FileSystem, Option, type Path } from "effect";
import { AgentSettings } from "./agent-settings.ts";
import { Agents } from "./agents.ts";
import type { BridgeHandlers } from "./bridge-server.ts";
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
  /** The SSH configuration whose hosts are suggested. */
  readonly sshConfig: string;
}

/** What the handlers run on. */
export type HandlerServices =
  | AgentSettings
  | Agents
  | FileSystem.FileSystem
  | NewDesigns
  | Notices
  | OpenProject
  | Path.Path
  | ProjectStore
  | Shell;

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
  "agents.setApiKey": (id, key) =>
    thenRestart(
      Agents.use((a) => a.setApiKey(id, key?.trim() ? key : undefined))
    ),
  // The agent keeps its sign-in itself: nothing to start again.
  "agents.signIn": (id) => Agents.use((a) => a.signIn(id)),
  "newDesign.create": (input, report) =>
    NewDesigns.use((n) => n.create(input, report)),
  "newDesign.folderFor": (name) => NewDesigns.use((n) => n.folderFor(name)),
  "newDesign.open": (folder, name, template) =>
    NewDesigns.use((n) => n.open(folder, name, template)),
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
  "projects.list": () =>
    Effect.map(
      ProjectStore.use((store) => store.list),
      (projects) =>
        projects.map((p) => ({
          detail: projectDetail(p),
          id: p.id,
          name: p.name,
        }))
    ),
  "projects.open": (id) => OpenProject.use((o) => o.open(id)),
  "projects.sshHosts": () => readSshHosts(options.sshConfig, options.home),
  "projects.stopOpening": () => OpenProject.use((o) => o.stopOpening),
});
