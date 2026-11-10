/**
 * A node's or a page's link and a node's reference, from their menus and the commands. The link
 * opens the editor on the page with the node selected and in view; an agent, or the editor's MCP
 * tools, take the link as they take the reference (`/orders#c_8x2k1q`) to find it.
 */
import type { Page } from "@ultrapaint/contracts/pages";
import { formatNodeRef, type NodeRef } from "@ultrapaint/shared/node-ref";
import { toast } from "sonner";
import { type Selection, useEditor } from "../state/editor.ts";
import { ownFrameOf } from "../state/frame-ref.ts";
import { reportError, useProject } from "../state/project.ts";
import { linkToNode } from "../state/url.ts";

/** The page a node of a frame is on, in its own frame or in a view of it; none beside the pages. */
const pageOfSelection = (target: Selection): Page | undefined => {
  const own = ownFrameOf(target.frame);
  return useProject.getState().pages.find((p) => p.id === own);
};

/**
 * Where a node of a frame is: its page's route, or the canvas beside the pages; and which canvas,
 * when there are several.
 */
const refOfSelection = (target: Selection): NodeRef & { canvas: string } => {
  const page = pageOfSelection(target);
  // A node beside the pages is on the canvas open.
  const canvas = page?.canvas ?? useEditor.getState().canvas ?? "";
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

/** Copies `link`, and says what it does, with a button that opens it. */
const copyLink = async (link: string) => {
  try {
    await writeClipboard(link);
    toast.success("Link copied", {
      action: { label: "Open", onClick: () => window.open(link, "_blank") },
      description:
        "It opens the editor on it, and an agent finds it by it, in the editor or outside.",
    });
  } catch (error) {
    reportError(error);
  }
};

/** Copies the link to a page: the editor opens on it, and an agent's tools take it. */
export const copyPageLink = (page: Page) =>
  copyLink(
    linkToNode({
      canvas: page.canvas,
      page: page.route === undefined ? page.id : null,
      route: page.route ?? null,
    })
  );

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
  const page = pageOfSelection(target);
  await copyLink(
    linkToNode({
      canvas: refOfSelection(target).canvas,
      nodeId: target.nodeId,
      page: page?.route === undefined ? (page?.id ?? null) : null,
      route: page?.route ?? null,
    })
  );
};
