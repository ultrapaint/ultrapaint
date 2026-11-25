/**
 * Copy as code (ADR 0150): the elements a menu acts on, written by the server as JSX without its
 * imports or as HTML that needs nothing of the application, put on the clipboard as one snippet.
 * The outermost of them, in the order the Layers panel lists them, each against its own parent's
 * layout as the Code tab writes it.
 *
 * The clipboard is written while the click's gesture holds: its write opens at once, its text a
 * promise the server's answers settle. Written after they return, a browser that asks for the
 * gesture would refuse it. One answer that fails takes the whole write down, so nothing half
 * written reaches the clipboard.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { CodeFormat } from "@ultrapaint/contracts/rpc";
import type { ParentLayout } from "@ultrapaint/design-document/css";
import { layerPath } from "@ultrapaint/design-document/instance-layers";
import { parentLayoutOf } from "@ultrapaint/design-document/slots";
import { walk } from "@ultrapaint/design-document/tree";
import { toast } from "sonner";
import { useComponents } from "../state/components.ts";
import { api } from "../state/connection.ts";
import { appFileOf, rootOfFrame, useDocuments } from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { reportError } from "../state/project.ts";
import { actedOn, outermost } from "./node-actions.ts";

/** An element to write: itself, its parent's layout, and its place in its frame's tree. */
interface Subject {
  readonly node: DesignNode;
  readonly parent: ParentLayout;
  readonly place: number;
}

/**
 * The elements the menu acts on, all in one frame as a selection is: the outermost of them, in
 * the order the Layers panel lists them, which is the order the frame's tree holds them.
 */
const subjectsOf = (target: Selection): Subject[] => {
  const { docs } = useDocuments.getState();
  const { canvas } = useEditor.getState();
  const { catalogue } = useComponents.getState();
  return outermost(actedOn(target))
    .flatMap((t): Subject[] => {
      const root = rootOfFrame(docs, canvas, t.frame);
      const path = root ? layerPath(root, t.nodeId, appFileOf) : null;
      const node = path?.at(-1);
      if (!(root && path && node)) {
        return [];
      }
      // Before what follows it in the tree; a layer of an instance, which the document does not
      // hold, where its instance is.
      const ids = Array.from(walk(root), (n) => n.id);
      return [
        {
          node,
          parent: parentLayoutOf(node, path.at(-2), catalogue),
          place: Math.max(...path.map((p) => ids.indexOf(p.id))),
        },
      ];
    })
    .sort((a, b) => a.place - b.place);
};

/** The clipboard's write opened now, its text whatever `text` settles to. */
const putOnClipboard = async (text: Promise<string>) => {
  // A request that failed is reported once, by the `await text` below, whatever the write does
  // first: never left unhandled.
  text.catch(() => undefined);
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (clipboard?.write && typeof ClipboardItem !== "undefined") {
    const blob = text.then((t) => new Blob([t], { type: "text/plain" }));
    // The clipboard reads it, or it fails with the request: handled either way.
    blob.catch(() => undefined);
    const written = clipboard.write([
      new ClipboardItem({ "text/plain": blob }),
    ]);
    // The write fails with the request: the request's failure is the one reported.
    written.catch(() => undefined);
    await text;
    await written;
    return;
  }
  const code = await text;
  if (!clipboard) {
    throw new Error("This browser has no clipboard to copy the code to.");
  }
  await clipboard.writeText(code);
};

/** Copies the elements' code in `format`, one after the other, and says so. */
export const copyCode = async (target: Selection, format: CodeFormat) => {
  const subjects = subjectsOf(target);
  if (subjects.length === 0) {
    return;
  }
  const { canvas } = useEditor.getState();
  const code = Promise.all(
    subjects.map(({ node, parent }) =>
      api().request("code.write", {
        ...(canvas !== null && { canvas }),
        format,
        imports: false,
        node,
        parent,
      })
    )
  ).then((answers) => answers.map((a) => a.code).join("\n\n"));
  try {
    await putOnClipboard(code);
    toast.success(format === "html" ? "HTML copied" : "JSX copied");
  } catch (error) {
    reportError(error);
  }
};
