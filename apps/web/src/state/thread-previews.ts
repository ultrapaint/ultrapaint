/**
 * The pictures of what threads work on, for the list of threads: the node a thread was started
 * on, or its page, drawn by the preview with the repository's own components. Drawn again only
 * when the document changed, and kept in the state directory so the list has them at once.
 */
import type { Thread } from "@ultrapaint/contracts/threads";
import { canvasDocOf } from "@ultrapaint/design-document/tree";
import { create } from "zustand";
import { drawSpecimen } from "../canvas/specimens.ts";
import { api } from "./connection.ts";
import { useDesignSystem } from "./design-system.ts";
import { frameOfCanvasNode, rootOfFrame, useDocuments } from "./documents.ts";
import { useEditor } from "./editor.ts";
import { previewUrl, useProject } from "./project.ts";

const KEY = "threads";
/** Twice the size the list shows them at. */
const SIZE = 112;

interface PreviewsStore {
  pictures: Record<string, string>;
}

export const useThreadPreviews = create<PreviewsStore>(() => ({
  pictures: {},
}));

/** What each thread's picture was drawn from: the document's hash and the node. */
const drawnFrom = new Map<string, string>();
let loaded: Promise<void> | null = null;

/** The pictures drawn in earlier sessions, named `<thread>__<what it was drawn from>`. */
const loadStored = () => {
  loaded ??= api()
    .request("thumbnails.get", { key: KEY })
    .then((stored) => {
      const pictures: Record<string, string> = {};
      for (const [name, dataUrl] of Object.entries(stored)) {
        const [threadId, from] = name.split("__");
        if (threadId && from) {
          pictures[threadId] = dataUrl;
          drawnFrom.set(threadId, from);
        }
      }
      useThreadPreviews.setState((s) => ({
        pictures: { ...pictures, ...s.pictures },
      }));
    })
    // No stored pictures only means they are drawn again.
    .catch(() => undefined);
  return loaded;
};

/** Scales a picture into a square: an element whole on white, a page from its top. */
const shrink = (dataUrl: string, whole: boolean) =>
  new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, SIZE, SIZE);
      const scale = whole
        ? Math.min(SIZE / img.width, SIZE / img.height)
        : SIZE / img.width;
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (SIZE - w) / 2, whole ? (SIZE - h) / 2 : 0, w, h);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

/** The document, the root to draw and how, for a thread's scope; null when it is not open here. */
const sourceOf = (thread: Thread) => {
  const { scope } = thread;
  if (!scope) {
    return null;
  }
  const { docs } = useDocuments.getState();
  const { frames, canvas } = useEditor.getState();
  const page = useProject.getState().pages.find((p) => p.file === scope.file);
  if (page) {
    const doc = docs[page.id];
    const frame = frames[page.id];
    return doc?.root
      ? {
          from: `${doc.hash}-${scope.nodeId ?? "page"}`,
          options: {
            canvas: page.canvas,
            height: frame?.height ?? 900,
            mode: "page" as const,
            width: frame?.width ?? 1440,
            ...(scope.nodeId === undefined ? {} : { nodeId: scope.nodeId }),
          },
          root: doc.root,
        }
      : null;
  }
  // A node beside the pages: drawn on its own, at its own size.
  if (scope.nodeId === undefined || canvas === null) {
    return null;
  }
  const frame = frameOfCanvasNode(docs, canvas, scope.nodeId);
  const root = frame ? rootOfFrame(docs, canvas, frame) : null;
  const hash = docs[canvasDocOf(canvas)]?.hash;
  return root
    ? {
        from: `${hash}-${scope.nodeId}`,
        options: { canvas, mode: "fit" as const, nodeId: scope.nodeId },
        root,
      }
    : null;
};

const draw = async (thread: Thread) => {
  const source = sourceOf(thread);
  const host = previewUrl(useProject.getState().info.host);
  if (!(source && host) || drawnFrom.get(thread.id) === source.from) {
    return;
  }
  drawnFrom.set(thread.id, source.from);
  const shot = await drawSpecimen(
    source.root,
    useDesignSystem.getState().designSystem,
    source.options
  );
  if (!shot) {
    return;
  }
  const picture = await shrink(shot, thread.scope?.nodeId !== undefined);
  useThreadPreviews.setState((s) => ({
    pictures: { ...s.pictures, [thread.id]: picture },
  }));
  api()
    .request("thumbnails.put", {
      dataUrl: picture,
      key: KEY,
      name: `${thread.id}__${source.from}`,
    })
    // Not kept means drawn again next time.
    .catch(() => undefined);
};

/** Brings the pictures of these threads up to date, one after the other. */
export const refreshPreviews = async (threads: readonly Thread[]) => {
  await loadStored();
  for (const thread of threads) {
    // biome-ignore lint/performance/noAwaitInLoops: one at a time, as the frame that draws them draws one thing.
    await draw(thread);
  }
};
