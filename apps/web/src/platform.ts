/**
 * What the editor asks of whatever it runs in. In a browser, nothing beyond the page: the server
 * is the page's own origin, a folder is a typed path, the preview is reached at its own URL and
 * there is one project. The desktop app (PLAN-desktop, ADR 0031) fills the rest in from its
 * preload script, as `window.ultrapaintPlatform`, before the editor loads; the editor imports
 * nothing of Electron.
 */
import { defaultServerUrl } from "@ultrapaint/client-runtime/connection";

/** A project the shell keeps, as its switcher lists it. */
export interface PlatformProject {
  /** Where it is, for the list: a folder, or a host and a path on it. */
  readonly detail?: string;
  readonly id: string;
  readonly name: string;
}

/** The shell's list of projects, for the switcher in the header. One project is open at a time. */
export interface ProjectSwitcher {
  /** Adds a project, through the shell's own dialog; absent when the shell cannot. */
  readonly add?: () => Promise<void>;
  /** The open project's id. */
  readonly current: () => Promise<string | null>;
  readonly list: () => Promise<readonly PlatformProject[]>;
  /**
   * Opens another project. The shell stops the open project's server, asking first when an agent
   * is working, starts the next one's and loads its editor in place of this one.
   */
  readonly open: (id: string) => Promise<void>;
}

/**
 * Something the shell found the editor will miss, and how to put it right: Node.js not
 * installed, say. Shown as a banner over the editor until it is dismissed.
 */
export interface ShellNotice {
  /** A command that puts it right, to copy. */
  readonly command?: string;
  readonly detail: string;
  readonly id: string;
  /** Where to read more or download what is missing; opens in the browser. */
  readonly link?: { readonly label: string; readonly url: string };
  readonly title: string;
}

/** How an agent stands on this machine, as the shell found it. */
export interface PlatformAgent {
  /** Whether the shell keeps an API key for it, which it signs in with. */
  readonly apiKey?: boolean;
  /** Whether the shell could keep a key for it: it takes one, and there is a keychain. */
  readonly canKeepKey?: boolean;
  /** The executable set in the shell's settings, in place of the one on the PATH. */
  readonly customPath?: string;
  /** What was found, or what is missing and how to put it right. */
  readonly detail: string;
  /** What the shell can download in its place, when it is missing: a release, its size in bytes. */
  readonly download?: { readonly size: number; readonly version: string };
  /** A download under way, or why the last one failed. */
  readonly downloading?: {
    readonly message?: string;
    readonly phase: string;
    readonly received: number;
    readonly total: number;
  };
  readonly executable?: string;
  /** The agent's id, as the server's agents have it: `claude-code`, `codex`. */
  readonly id: string;
  /** Where to read how to install it. */
  readonly install: string;
  readonly name: string;
  /**
   * How it signs in: by itself, in a terminal (Claude Code, which may not be signed in from
   * here), or with ChatGPT through the shell (Codex).
   */
  readonly signIn?: "terminal" | "chatgpt";
  /** Where the executable came from: the PATH, the shell's settings, or the shell's download. */
  readonly source?: "path" | "setting" | "download";
  /** `ready`: found and signed in; `signed-out`: found; `missing`: not found. */
  readonly state: "ready" | "signed-out" | "missing";
  readonly version?: string;
}

/**
 * The agents on this machine, as a shell that runs them finds them (the desktop app). A change
 * to where an agent is, or to its key, starts the project's server again, and the editor comes
 * back where it was.
 */
export interface AgentSetup {
  /** Picks the agent's executable with the shell's own dialog. */
  readonly choosePath: (id: string) => Promise<void>;
  /** Goes back to the agent on the PATH. */
  readonly clearPath: (id: string) => Promise<void>;
  /** Downloads the release `download` names; done once it is installed. */
  readonly download: (id: string) => Promise<void>;
  readonly list: () => Promise<readonly PlatformAgent[]>;
  /** Keeps the key the agent signs in with; `null` forgets it. */
  readonly setApiKey: (id: string, key: string | null) => Promise<void>;
  /** Signs in through the shell (`chatgpt`): the browser opens, and this ends once it is done. */
  readonly signIn: (id: string) => Promise<void>;
}

/** A design from nothing (PLAN-desktop D11), as the dialog asks for it. */
export interface NewDesignInput {
  /** Where the application's code goes: `app/` beside the designs, or the folder's root. */
  readonly code: "app" | "root";
  /** Absolute; made when it is not there, and empty otherwise. */
  readonly folder: string;
  /** A first commit, and the git integration on; off, nothing is written to git. */
  readonly git: boolean;
  readonly name: string;
  /** `blank`: no components; `starter`: ten to design with. */
  readonly template: "blank" | "starter";
}

/** The steps of writing a new design, in order; `open` is the shell's, once it is written. */
export type NewDesignStep = "folder" | "write" | "install" | "git" | "open";

/** How a step goes, as the shell reports it. */
export interface NewDesignProgress {
  /** What it did, or why it failed. */
  readonly detail?: string;
  readonly state: "active" | "done" | "skipped" | "failed";
  readonly step: NewDesignStep;
}

/** Writing a new design and opening it, which the shell does without a server (the desktop app). */
export interface NewDesigns {
  /**
   * Writes it, telling `onProgress` how each step goes, then opens it in place of the open
   * project, which the shell stops (asking first when an agent is working). Resolves with the
   * step that failed, when one does: what the steps before it did stays.
   */
  readonly create: (
    input: NewDesignInput,
    onProgress: (progress: NewDesignProgress) => void
  ) => Promise<{
    readonly failed?: {
      readonly message: string;
      readonly step: NewDesignStep;
    };
  }>;
  /**
   * Where a design of that name goes unless another folder is picked: a folder of that name
   * in `~/Ultrapaint`, numbered when one is there already.
   */
  readonly folderFor: (name: string) => Promise<string>;
  /** Opens a design whose writing stopped part of the way, as it is. */
  readonly open: (
    folder: string,
    name: string,
    template: NewDesignInput["template"]
  ) => Promise<void>;
}

export interface Platform {
  /** The agents on this machine; absent in a browser, where the server's own are all there is. */
  readonly agents?: AgentSetup;
  /**
   * The preview's URL as this window reaches it. The server names the preview by its address
   * on the server's machine; a server on another machine, over SSH, is reached through a port
   * the shell forwards. Synchronous: the shell answers from forwards it already holds. Absent,
   * the URL is used as it is.
   */
  readonly mapPreviewUrl?: (url: string) => string;
  /** New designs from nothing; absent in a browser, where the server's folder is the project. */
  readonly newDesign?: NewDesigns;
  /** What the shell found missing on this machine; absent in a browser. */
  readonly notices?: () => Promise<readonly ShellNotice[]>;
  /** A native folder picker; absent in a browser, where a path is typed. Null when cancelled. */
  readonly pickFolder?: (options?: {
    readonly defaultPath?: string;
    readonly title?: string;
  }) => Promise<string | null>;
  /** The shell's projects; absent in a browser, where the server's folder is the project. */
  readonly projects?: ProjectSwitcher;
  /** The server's WebSocket: a backend that is not the origin the editor was served from. */
  readonly serverUrl: string;
}

/** What a shell's preload script may set; every part of it is optional. */
type ShellPlatform = Partial<Platform>;

let current: Platform | null = null;

/** The platform the editor runs on: the browser's, with whatever the shell gave over it. */
export const platform = (): Platform => {
  if (!current) {
    const shell = (globalThis as { ultrapaintPlatform?: ShellPlatform })
      .ultrapaintPlatform;
    current = { ...shell, serverUrl: shell?.serverUrl ?? defaultServerUrl() };
  }
  return current;
};

/** For tests: the platform as a shell would set it, or the browser's again with `null`. */
export const setPlatform = (next: Platform | null) => {
  current = next;
};
