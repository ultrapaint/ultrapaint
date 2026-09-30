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

/**
 * Where a node of a frame is: its page's route, or the canvas beside the pages; and which canvas,
 * when there are several.
 */
export const refOfSelection = (
  target: Selection
): NodeRef & { canvas: string } => {
  const { pages } = useProject.getState();
  const page = pages.find((p) => p.id === target.frame);
  const canvas = page?.canvas ?? "";
  return {
    canvas,
    nodeId: target.nodeId,
    // A page without a URL is named by its file inside the canvas.
    page: page ? (page.route ?? page.path) : null,
  };
};

const writeClipboard = async (text: string) => {
  await navigator.clipboard.writeText(text);
};

export const copyNodeRef = async (target: Selection) => {
  const ref = refOfSelection(target);
  const several = useProject.getState().canvases.length > 1;
  const text = formatNodeRef(
    several ? ref : { nodeId: ref.nodeId, page: ref.page }
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
  const page = useProject.getState().pages.find((p) => p.id === target.frame);
  const link = linkToNode({
    canvas: refOfSelection(target).canvas,
    nodeId: target.nodeId,
    page: page?.route === undefined ? (page?.id ?? null) : null,
    route: page?.route ?? null,
  });
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
