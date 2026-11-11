/**
 * The components placed last from the Library (ADR 0045), newest first: what its Recent group
 * shows. Kept in the browser per project, by the repository's path, so another project opened in
 * the same editor has its own.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import { create } from "zustand";
import { useProject } from "./project.ts";

/** How many it keeps, which is how many the group shows. */
const KEPT = 4;

const keyOf = (repoPath: string | undefined) =>
  `ultrapaint:recent-components:${repoPath ?? ""}`;

const stored = (key: string): readonly string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((n): n is string => typeof n === "string").slice(0, KEPT)
      : [];
  } catch {
    // Unreadable means none placed yet: the next placement starts the list again.
    return [];
  }
};

/** What was read or placed, by project; a project not in it is read from the browser. */
const useRecent = create<{
  byKey: Readonly<Record<string, readonly string[]>>;
}>(() => ({ byKey: {} }));

/** The open project's components placed last, by name, newest first. */
export const useRecentComponents = (): readonly string[] => {
  const key = useProject((s) => keyOf(s.info.repoPath));
  return useRecent((s) => s.byKey[key]) ?? stored(key);
};

/** Notes a node placed from the Library: an instance's component goes to the head of Recent. */
const placedComponent = (node: DesignNode) => {
  if (node.type !== "instance") {
    return;
  }
  const key = keyOf(useProject.getState().info.repoPath);
  const before = useRecent.getState().byKey[key] ?? stored(key);
  const names = [
    node.component,
    ...before.filter((n) => n !== node.component),
  ].slice(0, KEPT);
  localStorage.setItem(key, JSON.stringify(names));
  useRecent.setState((s) => ({ byKey: { ...s.byKey, [key]: names } }));
};

/** After an insert: the node is noted only when it landed. */
export const noteLanded =
  (node: DesignNode) =>
  (created: readonly string[]): void => {
    if (created.length > 0) {
      placedComponent(node);
    }
  };
