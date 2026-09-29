/**
 * A node's link and its reference, from its menu. The link opens the editor on the node's page
 * with the node selected and in view; the reference (`/orders#c_8x2k1q`) is what an agent, or the
 * editor's MCP tools, take to find it.
 */
import { formatNodeRef, type NodeRef } from "@ultrapaint/shared/node-ref";
import { toast } from "sonner";
import type { Selection } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";
import { linkToNode } from "../state/url.ts";

/** Where a node of a frame is: its page's route, or the canvas; the space when there are several. */
export const refOfSelection = (
  target: Selection
): NodeRef & { space: string } => {
  const { pages } = useProject.getState();
  const page = pages.find((p) => p.id === target.frame);
  const space = page?.space ?? "";
  return {
    nodeId: target.nodeId,
    route: page?.route ?? null,
    space,
  };
};

const writeClipboard = async (text: string) => {
  await navigator.clipboard.writeText(text);
};

export const copyNodeRef = async (target: Selection) => {
  const ref = refOfSelection(target);
  const several = useProject.getState().spaces.length > 1;
  const text = formatNodeRef(
    several ? ref : { nodeId: ref.nodeId, route: ref.route }
  );
  try {
    await writeClipboard(text);
    toast.success("Element ID copied", {
      description: `${text} — an agent finds the element by it.`,
    });
  } catch (error) {
    reportError(error);
  }
};

export const copyNodeLink = async (target: Selection) => {
  const link = linkToNode(refOfSelection(target));
  try {
    await writeClipboard(link);
    toast.success("Link copied", {
      action: { label: "Open", onClick: () => window.open(link, "_blank") },
      description: "It opens the editor with this element selected.",
    });
  } catch (error) {
    reportError(error);
  }
};
