/**
 * What the editor keeps in the browser's storage that is the open project's own (ADR 0107): the
 * threads seen, the panels' widths. The desktop app's project views share one origin, so each
 * keeps these under its project's key: the desktop's id of the project (`projectId`), which tells
 * apart one path on two machines, known as the page loads; in a browser, its folder once the
 * project is read. Before, and for what was kept before the tabs, the key every project shared.
 */
import { shellPlatform } from "../platform.ts";
import { useProject } from "./project.ts";

/** What tells the project apart: the shell's id, else its folder; none until it is read. */
const projectOf = (repoPath: string | undefined) => {
  const id = shellPlatform().projectId?.current();
  if (id) {
    return `project:${id}`;
  }
  return repoPath;
};

const keyFor = (base: string, project: string | undefined) =>
  project ? `${base}:${project}` : base;

/** The open project's key for `base`: `base` alone until the project is known. */
export const projectKey = (base: string) =>
  keyFor(base, projectOf(useProject.getState().info.repoPath));

/** The open project's key for `base` as it changes: null until the project is known. */
export const useProjectKey = (base: string) =>
  useProject((s) => {
    const project = projectOf(s.info.repoPath);
    return project ? keyFor(base, project) : null;
  });

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
