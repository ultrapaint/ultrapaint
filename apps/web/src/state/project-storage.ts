/**
 * What the editor keeps in the browser's storage that is the open project's own (ADR 0107): the
 * threads seen, the panels' widths. The desktop app's pages share one origin, a page per open
 * project, so each keeps these under its project's key, its folder, once the project is read;
 * before, and for what was kept before the tabs, the key every project shared.
 */
import { useProject } from "./project.ts";

const keyFor = (base: string, repoPath: string | undefined) =>
  repoPath ? `${base}:${repoPath}` : base;

/** The open project's key for `base`: `base` alone until the project is read. */
export const projectKey = (base: string) =>
  keyFor(base, useProject.getState().info.repoPath);

/** The open project's key for `base` as it changes: null until the project is read. */
export const useProjectKey = (base: string) =>
  useProject((s) => (s.info.repoPath ? keyFor(base, s.info.repoPath) : null));

/** What is kept for the open project, else what every project shared; null for nothing. */
export const readProjectItem = (base: string, key = projectKey(base)) => {
  try {
    return localStorage.getItem(key) ?? localStorage.getItem(base);
  } catch {
    // Storage refused (a private window): nothing kept, as on a first open.
    return null;
  }
};

/** Keeps a value for the open project. */
export const writeProjectItem = (
  base: string,
  value: string,
  key = projectKey(base)
) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage refused: the next open starts from the default, which is all that is lost.
  }
};
