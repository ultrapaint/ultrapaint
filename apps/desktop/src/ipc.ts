/**
 * The channels between the preload script, which fills the editor's `Platform` (ADR 0031), and
 * the main process. Only the app's own window calls them.
 */
export const Channel = {
  agentsChoosePath: "ultrapaint:agents-choose-path",
  agentsClearPath: "ultrapaint:agents-clear-path",
  agentsDownload: "ultrapaint:agents-download",
  agentsList: "ultrapaint:agents-list",
  agentsSetApiKey: "ultrapaint:agents-set-api-key",
  agentsSignIn: "ultrapaint:agents-sign-in",
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
  /** Whether an API key is kept for it (Claude Code). */
  readonly apiKey?: boolean;
  /** Whether it could keep one: there is a keychain to keep it in. */
  readonly canKeepKey?: boolean;
  /** The executable set in the app's settings, in place of the PATH's. */
  readonly customPath?: string;
  /** What was found, or what is missing and how to put it right: a sentence or two. */
  readonly detail: string;
  /** The release the app can download, when the agent is missing; its size in bytes. */
  readonly download?: { readonly size: number; readonly version: string };
  /** A download under way, or the reason the last one failed. */
  readonly downloading?: {
    readonly message?: string;
    readonly phase: string;
    readonly received: number;
    readonly total: number;
  };
  readonly executable?: string;
  readonly id: string;
  /** Where to read how to install it. */
  readonly install: string;
  readonly name: string;
  /** How it signs in: in a terminal (or with a key), or with ChatGPT through the app. */
  readonly signIn?: "terminal" | "chatgpt";
  readonly source?: "path" | "setting" | "download";
  /** `ready`: found and signed in. */
  readonly state: "ready" | "signed-out" | "missing";
  readonly version?: string;
}
