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
  newDesignCreate: "ultrapaint:new-design-create",
  newDesignFolder: "ultrapaint:new-design-folder",
  newDesignOpen: "ultrapaint:new-design-open",
  /** From the main process: how a step of the new design goes. */
  newDesignProgress: "ultrapaint:new-design-progress",
  notices: "ultrapaint:notices",
  pickFolder: "ultrapaint:pick-folder",
  /** Synchronous: the preview's URL as the window reaches it (`Platform.mapPreviewUrl`). */
  previewUrl: "ultrapaint:preview-url",
  projectsAdd: "ultrapaint:projects-add",
  projectsAddRemote: "ultrapaint:projects-add-remote",
  projectsCurrent: "ultrapaint:projects-current",
  projectsList: "ultrapaint:projects-list",
  projectsOpen: "ultrapaint:projects-open",
  /** Synchronous, as the page loads: what the open project is (`ShellInfo`). */
  shellInfo: "ultrapaint:shell-info",
  /** From the main process: what the app is doing for the open project (`ShellStatus`). */
  shellStatus: "ultrapaint:shell-status",
  sshHosts: "ultrapaint:ssh-hosts",
} as const;

/** What the preload script needs to know before the page loads. */
export interface ShellInfo {
  /**
   * The open project's server runs on another machine: its preview is reached through a
   * forwarded port, and its agents are that machine's, not this one's.
   */
  readonly remote: boolean;
  /** What the app is doing for it as the page loads: reconnecting, say. */
  readonly status: ShellStatus | null;
}

/** What the app is doing for the open project (`ShellStatus` in the editor). */
export interface ShellStatus {
  readonly detail?: string | undefined;
  readonly message: string;
}

/** The answer to `previewUrl`: kept by the page only once it is forwarded. */
export interface MappedUrl {
  readonly forwarded: boolean;
  readonly url: string;
}

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

/** A folder on another machine, as the dialog asks for it (`RemoteProjectInput` in the editor). */
export interface RemoteProjectRequest {
  /** What runs the server there; `ultrapaint` when empty. */
  readonly command?: string;
  /** `alias`, `host`, `user@host` or `user@host:port`. */
  readonly host: string;
  readonly path: string;
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

/** A design from nothing, as the dialog asks for it (`NewDesignInput` in the editor). */
export interface NewDesignRequest {
  readonly code: "app" | "root";
  readonly folder: string;
  readonly git: boolean;
  readonly name: string;
  readonly template: "blank" | "starter";
}

/** The steps of a new design: the server's, then the app's own `open`. */
export type NewDesignStepId = "folder" | "write" | "install" | "git" | "open";

/** How a step goes (`NewDesignProgress` in the editor). */
export interface NewDesignUpdate {
  readonly detail?: string;
  readonly state: "active" | "done" | "skipped" | "failed";
  readonly step: NewDesignStepId;
}

/** How it ended: the step that failed, when one did. */
export interface NewDesignOutcome {
  readonly failed?: {
    readonly message: string;
    readonly step: NewDesignStepId;
  };
}
