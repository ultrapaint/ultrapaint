/**
 * Canvas items that are not dragged out of a page: images pasted or dropped on the canvas, and
 * taking an item away again.
 */
import { toast } from "sonner";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { reportError } from "../state/project.ts";

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

/**
 * Saves each image into the space and puts it on the canvas at `at`, the next one to the right
 * of the one before.
 */
export const addImages = async (
  files: readonly File[],
  at: { x: number; y: number }
) => {
  const { space } = useEditor.getState();
  if (space === null) {
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
      const frame = {
        height: Math.round(natural.height * scale),
        preset: "custom" as const,
        width,
        x: Math.round(x),
        y: Math.round(at.y),
      };
      const { item } = await api().request("canvas.addImage", {
        data,
        frame,
        name: file.name || `image.${file.type.split("/")[1] ?? "png"}`,
        space,
      });
      const s = useEditor.getState();
      s.addItem(item, frame);
      s.selectPage(item.id);
      x += width + 40;
    } catch (error) {
      reportError(error);
    }
  }
};

/** Takes the item off the canvas and deletes its module. */
export const deleteItem = async (id: string) => {
  const s = useEditor.getState();
  const item = s.items[id];
  if (!item) {
    return;
  }
  try {
    await api().request("canvas.removeItem", { id, space: item.space });
  } catch (error) {
    reportError(error);
    return;
  }
  s.removeItem(id);
  toast(`Removed ${item.name} from the canvas`, {
    description: "⌘Z puts it back",
  });
};
