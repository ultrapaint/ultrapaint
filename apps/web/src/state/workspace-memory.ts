/**
 * What a workspace keeps while another is shown. The prototype shows no selection, so it puts
 * the canvas's aside, and hands it back when the canvas is shown again. The tool in hand is each
 * workspace's own. Pure, so it can be tested without an editor.
 */
import type { Mode, Selection, Workspace } from "./editor.ts";

/** What is selected: a node with the others picked beside it, or a page as a whole. */
export interface Picked {
  also: readonly Selection[];
  selectedPage: string | null;
  selection: Selection | null;
}

export interface WorkspaceMemory {
  /** The tool each workspace was left with. */
  modes: Partial<Record<Workspace, Mode>>;
  /** The canvas's selection, kept while the prototype is shown. */
  putAside: Picked | null;
}

export const nothingPicked: Picked = {
  also: [],
  selectedPage: null,
  selection: null,
};

export const emptyMemory: WorkspaceMemory = { modes: {}, putAside: null };

/** Whether a workspace shows the canvas, and so the selection on it. */
const showsCanvas = (workspace: Workspace) => workspace !== "prototype";

/** The prototype is clicked through, or commented on: no other tool means anything there. */
const prototypeModes: readonly Mode[] = ["interact", "comment"];

/** The tool a workspace is found with: the one it was left with, or its first. */
export const modeFor = (workspace: Workspace, left: Mode | undefined): Mode => {
  if (workspace === "prototype") {
    return left && prototypeModes.includes(left) ? left : "interact";
  }
  return left ?? "select";
};

/** What can still be found of a selection: nodes and pages since deleted are left out. */
export const stillThere = (
  picked: Picked,
  exists: { node: (s: Selection) => boolean; page: (id: string) => boolean }
): Picked => {
  const [selection = null, ...also] = [
    ...(picked.selection ? [picked.selection] : []),
    ...picked.also,
  ].filter(exists.node);
  return {
    // The others belong to the frame of the one the inspector shows.
    also: selection ? also.filter((s) => s.frame === selection.frame) : [],
    selectedPage:
      picked.selectedPage !== null && exists.page(picked.selectedPage)
        ? picked.selectedPage
        : null,
    selection,
  };
};

/**
 * Going from one workspace to another: the tool and the selection the next one has, and what is
 * kept of the one left behind.
 */
export const switchWorkspace = (
  from: { mode: Mode; picked: Picked; workspace: Workspace },
  to: Workspace,
  memory: WorkspaceMemory,
  exists: Parameters<typeof stillThere>[1]
): { memory: WorkspaceMemory; mode: Mode; picked: Picked } => {
  const modes = { ...memory.modes, [from.workspace]: from.mode };
  const mode = modeFor(to, modes[to]);
  if (!showsCanvas(to)) {
    return {
      memory: {
        modes,
        putAside: showsCanvas(from.workspace) ? from.picked : memory.putAside,
      },
      mode,
      picked: nothingPicked,
    };
  }
  if (showsCanvas(from.workspace)) {
    return { memory: { ...memory, modes }, mode, picked: from.picked };
  }
  return {
    memory: { modes, putAside: null },
    mode,
    picked: memory.putAside
      ? stillThere(memory.putAside, exists)
      : nothingPicked,
  };
};
