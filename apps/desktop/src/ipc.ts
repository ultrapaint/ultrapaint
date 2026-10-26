/**
 * The channels between the preload script, which fills the editor's `Platform` (ADR 0031), and
 * the main process. Only the editor's own window calls them.
 */
export const Channel = {
  pickFolder: "ultrapaint:pick-folder",
} as const;

/** What `pickFolder` takes, as the editor's `Platform` says it. */
export interface PickFolderOptions {
  readonly defaultPath?: string | undefined;
  readonly title?: string | undefined;
}
