/**
 * The channels between the preload script, which fills the editor's `Platform` (ADR 0031), and
 * the main process. Only the app's own window calls them.
 */
export const Channel = {
  agentsChoosePath: "ultrapaint:agents-choose-path",
  agentsClearPath: "ultrapaint:agents-clear-path",
  agentsList: "ultrapaint:agents-list",
  notices: "ultrapaint:notices",
  pickFolder: "ultrapaint:pick-folder",
  projectsAdd: "ultrapaint:projects-add",
  projectsCurrent: "ultrapaint:projects-current",
  projectsList: "ultrapaint:projects-list",
  projectsOpen: "ultrapaint:projects-open",
} as const;

/** What `pickFolder` takes, as the editor's `Platform` says it. */
export interface PickFolderOptions {
  readonly defaultPath?: string | undefined;
  readonly title?: string | undefined;
}

/** A project as the switcher lists it (`PlatformProject` in the editor). */
export interface ListedProject {
  readonly detail?: string;
  readonly id: string;
  readonly name: string;
}

/** Something the app found the editor will miss (`ShellNotice` in the editor). */
export interface ShellNotice {
  readonly command?: string;
  readonly detail: string;
  readonly id: string;
  readonly link?: { readonly label: string; readonly url: string };
  readonly title: string;
}

/** How an agent stands on this machine (`PlatformAgent` in the editor). */
export interface AgentStatus {
  /** The executable set in the app's settings, in place of the PATH's. */
  readonly customPath?: string;
  /** What was found, or what is missing and how to put it right: a sentence or two. */
  readonly detail: string;
  readonly executable?: string;
  readonly id: string;
  /** Where to read how to install it. */
  readonly install: string;
  readonly name: string;
  readonly source?: "path" | "setting";
  /** `ready`: found and signed in. */
  readonly state: "ready" | "signed-out" | "missing";
  readonly version?: string;
}
