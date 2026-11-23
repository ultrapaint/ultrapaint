/**
 * What a component's menu does to its file (ADR 0042): take a system component's look over, reset
 * it, or delete an app component, from its row in the Library or its board's "…" alike (ADR 0102).
 */
import { OVERVIEW } from "../boards/library-boards.ts";
import { openBoard, useBoard } from "../state/board.ts";
import { api } from "../state/connection.ts";
import { reportError } from "../state/project.ts";

/** Removes a component's file, without asking: one undo step brings it back. True when it went. */
export const removeComponent = async (name: string) => {
  try {
    await api().request("components.remove", { name });
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
};

/** Starts a system component's file from its default look, so the design edits real values. */
export const takeOverLook = async (name: string) => {
  try {
    await api().request("components.fromDefault", { name });
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
};

/** Deletes an app component; its board, when open, gives way to the Library's overview. */
export const deleteAppComponent = async (name: string) => {
  const removed = await removeComponent(name);
  const { open } = useBoard.getState();
  if (removed && open?.view === "library" && open.item === name) {
    openBoard({ item: OVERVIEW, view: "library" }, "replace");
  }
  return removed;
};
