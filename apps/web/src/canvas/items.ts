/**
 * Images pasted or dropped on the canvas: saved into the shared assets, and shown by an image
 * node placed where they were dropped, the next one to the right of the one before.
 */

import { canvasDocOf } from "@ultrapaint/design-document/tree";
import { api } from "../state/connection.ts";
import { applyOps } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { reportError } from "../state/project.ts";
import { ensureEditable } from "../state/setup.ts";
import { frameOfNode } from "./drag.ts";

/** Widest an image lands at, in canvas units; a screenshot would otherwise cover everything. */
const MAX_IMAGE_WIDTH = 480;

const base64Of = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const sizeOf = async (file: File) => {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { height: bitmap.height, width: bitmap.width };
    bitmap.close();
    return size;
  } catch {
    // An SVG without intrinsic size: a square it can be resized from.
    return { height: 240, width: 240 };
  }
};

/** Files a drop or a paste carries that the canvas shows as images. */
export const imageFiles = (files: FileList | readonly File[] | null) =>
  Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));

/** Saves each image into the shared assets and puts an image node on the canvas at `at`. */
export const addImages = async (
  files: readonly File[],
  at: { x: number; y: number }
) => {
  const { canvas } = useEditor.getState();
  if (!ensureEditable() || canvas === null) {
    return;
  }
  let { x } = at;
  // One after the other: each lands to the right of the one before.
  for (const file of files) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: each image is placed beside the last.
      const [data, natural] = await Promise.all([base64Of(file), sizeOf(file)]);
      const scale = Math.min(1, MAX_IMAGE_WIDTH / natural.width);
      const width = Math.round(natural.width * scale);
      const { src } = await api().request("assets.upload", {
        data,
        name: file.name || `image.${file.type.split("/")[1] ?? "png"}`,
      });
      const result = await applyOps(
        canvasDocOf(canvas),
        [
          {
            node: {
              alt: file.name,
              height: Math.round(natural.height * scale),
              id: "img",
              src,
              type: "image",
              width,
              x: Math.round(x),
              y: Math.round(at.y),
            },
            op: "insert",
            parent: null,
          },
        ],
        "Add an image"
      );
      const id = result?.created[0];
      if (id) {
        useEditor.getState().select({ frame: frameOfNode(id), nodeId: id });
      }
      x += width + 40;
    } catch (error) {
      reportError(error);
    }
  }
};
