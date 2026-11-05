/**
 * What the editor does with the settings, from the settings dialog, Sync and a
 * new application alike: nothing else asks the server to save them. The server puts what it
 * saves in force; a save here then leaves the project store holding what the server has, its
 * settings, its info and the pages of the project it opened.
 */

import type {
  PersistInput,
  PersistResult,
  Settings,
} from "@ultrapaint/contracts/settings";
import {
  applySuggestions,
  type SetupSuggestions,
} from "@ultrapaint/contracts/setup";
import { api } from "../state/connection.ts";
import { useProject } from "../state/project.ts";

/**
 * Saves the settings, and reads the project again: the server's `project` event brings the
 * settings, but may come after the answer, and the pages are read again only when another
 * repository opened. Returns what is wrong with them, nothing when they were saved.
 */
export const save = async (next: Settings): Promise<readonly string[]> => {
  const validation = await api().request("settings.set", next);
  if (validation.ok) {
    await useProject.getState().load();
  }
  return validation.problems;
};

/**
 * Saves an unsaved session to a configuration file, with the settings it runs, and reads the
 * project again. A file already there is a conflict, unless `overwrite`.
 */
export const saveToFile = async (
  input: PersistInput
): Promise<PersistResult> => {
  const result = await api().request("settings.persist", input);
  if (result.validation.ok) {
    await useProject.getState().load();
  }
  return result;
};

/** What detection found in a repository, and how it proposes to change settings. */
export interface Detection {
  readonly found: SetupSuggestions;
  /**
   * `draft` with where the stylesheets and the application are, the hints for implementing, and
   * where the pages go unless `keepDesignsDir`; every other field as `draft` has it.
   * Given the draft as it is when detection answers, it keeps what was typed meanwhile, and is a
   * state updater as it is.
   */
  readonly onto: (draft: Settings) => Settings;
}

/** Reads the repository at `repoPath` for what it proposes. */
export const detect = async (
  repoPath: string,
  options: { readonly keepDesignsDir?: boolean } = {}
): Promise<Detection> => {
  const found = await api().request("setup.detect", { repoPath });
  return {
    found,
    onto: (draft) =>
      applySuggestions(
        draft,
        options.keepDesignsDir
          ? { ...found, designsDirs: [draft.designsDir] }
          : found
      ),
  };
};

/**
 * Creates the designs directory the settings name when it is not there yet (nothing else is
 * written), then saves them. Returns what is wrong with them, nothing when they were saved.
 */
export const setUpDesigns = async (
  next: Settings
): Promise<readonly string[]> => {
  await api().request("setup.createDesigns", {
    designsDir: next.designsDir,
    repoPath: next.repoPath,
  });
  return await save(next);
};
