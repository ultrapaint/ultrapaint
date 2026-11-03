/**
 * Images pasted into a chat's composer, attached to its next prompt as chips: a screenshot from
 * the clipboard, or image files copied in a file manager. An image the agents' models take as it
 * is (PNG, JPEG, GIF or WebP, up to 5 MB) goes byte for byte; any other is drawn smaller as WebP.
 */
import { toast } from "sonner";
import { addChip, imageChip } from "../state/attachments.ts";

/** The image types every agent's model reads. */
const TAKEN = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

/** What a model takes in one image: Claude's limit, the lowest of the agents'. */
const MAX_BYTES = 5 * 1024 * 1024;

/** The longest side an image is drawn at when it has to be made smaller. */
const MAX_SIDE = 2000;

/** The image files a paste carries; none for a paste of text alone. */
export const pastedImages = (data: DataTransfer | null): File[] =>
  [...(data?.files ?? [])].filter((file) => file.type.startsWith("image/"));

/** A size scaled down, never up, so its longest side is at most `max`. */
export const fitWithin = (width: number, height: number, max: number) => {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
};

/**
 * The name a chip shows: a file's own, or "Pasted image" for the clipboard's, which browsers
 * call `image.png` whatever it shows.
 */
export const pastedName = (file: File) =>
  file.name && file.name !== "image.png" ? file.name : "Pasted image";

const readDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** The image drawn smaller, as WebP; null when the browser cannot read it. */
const redrawn = async (file: File): Promise<string | null> => {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    return null;
  }
  const { height, width } = fitWithin(bitmap.width, bitmap.height, MAX_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.9);
};

/** The data URL the prompt carries for `file`. */
const dataUrlOf = (file: File): Promise<string | null> =>
  TAKEN.has(file.type) && file.size <= MAX_BYTES
    ? readDataUrl(file)
    : redrawn(file);

/** Attaches `files` to the thread's next prompt, in the order pasted; says which could not be. */
export const attachImages = async (
  threadId: string,
  files: readonly File[]
) => {
  const read = await Promise.all(
    files.map((file) => dataUrlOf(file).catch(() => null))
  );
  for (const [i, file] of files.entries()) {
    const dataUrl = read[i];
    if (dataUrl) {
      addChip(threadId, imageChip(pastedName(file), dataUrl));
    } else {
      toast.error(`${pastedName(file)} could not be read as an image.`);
    }
  }
};
