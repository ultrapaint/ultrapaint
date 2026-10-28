/** The nodes the Vibe toolbar's controls change, shared by the toolbar and its popovers. */
import type { DesignNode } from "@ultrapaint/contracts/document";
import { createContext, useContext } from "react";
import type { Selection } from "../state/editor.ts";
import { useDrawnNodes } from "../state/selection.ts";

/** The selection the controls change: one node or several. */
export const Targets = createContext<readonly Selection[]>([]);

/** The nodes the toolbar changes, as their view draws them: its breakpoint's values (ADR 0036). */
export const useTargetNodes = (): readonly DesignNode[] =>
  useDrawnNodes(useContext(Targets));
