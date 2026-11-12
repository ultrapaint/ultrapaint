/**
 * What the editor asks of whatever it runs in. In a browser, nothing beyond the page: the server
 * is the page's own origin, a folder is a typed path and there is one project. The desktop app
 * (PLAN-desktop, ADR 0031) fills the rest in from its preload script, as
 * `window.ultrapaintPlatform`, before the editor loads; the editor imports nothing of Electron.
 */
import { defaultServerUrl } from "@ultrapaint/client-runtime/connection";
import type { ShellPlatform } from "@ultrapaint/contracts/shell-bridge";

/**
 * The shell's capabilities, each declared once in the shell bridge's table, which gives their
 * types here and the desktop app's preload and main process their channels and Schemas.
 */
export type {
  InstalledCommand,
  NewDesignStepId,
  PlatformAgent,
  PlatformProject,
  ShellNotice,
  ShellPlatform,
  ShellStatus,
} from "@ultrapaint/contracts/shell-bridge";

/**
 * The agents on this machine, as a shell that runs them finds them (the desktop app). A change
 * to where an agent is, or to its key, starts the project's server again, and the editor comes
 * back where it was.
 */
export type AgentSetup = ShellPlatform["agents"];

/** The shell's list of projects, for the switcher in the header. One project is open at a time. */
export type ProjectSwitcher = ShellPlatform["projects"];

/** The shell's status, as it changes. */
export type ShellStatusSource = ShellPlatform["shellStatus"];

/**
 * What the editor runs on: the browser's server, and what a shell adds, each part absent in a
 * browser (no agents of this machine, no native folder picker, no projects but the server's
 * folder, no new designs, nothing the shell does for the project) and
 * where the shell does not show it (this machine's agents and notices for a project on another
 * one; the window's buttons where the system draws the frame).
 */
export interface Platform extends Partial<ShellPlatform> {
  /** The server's WebSocket: a backend that is not the origin the editor was served from. */
  readonly serverUrl: string;
}

let current: Platform | null = null;

/** The platform the editor runs on: the browser's, with whatever the shell gave over it. */
export const platform = (): Platform => {
  if (!current) {
    // What a shell's preload script set (the desktop app's `bridge.ts`): every part optional.
    const shell = (globalThis as { ultrapaintPlatform?: Partial<Platform> })
      .ultrapaintPlatform;
    current = { ...shell, serverUrl: shell?.serverUrl ?? defaultServerUrl() };
  }
  return current;
};

/** For tests: the platform as a shell would set it, or the browser's again with `null`. */
export const setPlatform = (next: Platform | null) => {
  current = next;
};
