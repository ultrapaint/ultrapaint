/**
 * The channels between the preload script, which fills the editor's `Platform` (ADR 0031), and
 * the main process. Only the app's own window calls them.
 */
export const Channel = {
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
