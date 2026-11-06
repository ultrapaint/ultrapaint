/**
 * Files attached to a prompt (ADR 0064), pasted, dropped or picked from disk: a picture becomes
 * an image chip, a text file a chip of its text, and anything else is refused, saying what to do
 * instead. A picture the agents' models take as it is (PNG, JPEG, GIF or WebP, up to 5 MB) goes
 * byte for byte; any other is drawn smaller as WebP. A prompt carries at most `MAX_PICTURES`
 * pictures and `MAX_TEXT_BYTES` of text, so what it sends fits the wire and the agent's context.
 */
import { TEXT_ATTACHMENT_LIMIT } from "@ultrapaint/contracts/threads";
import { toast } from "sonner";
import {
  addChip,
  type Chip,
  type ImageChip,
  imageChip,
  type TextChip,
  textChip,
  useAttachments,
} from "../state/attachments.ts";

/** The image types every agent's model reads. */
const TAKEN = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

/** What a model takes in one image: Claude's limit, the lowest of the agents'. */
const MAX_BYTES = 5 * 1024 * 1024;

/** The largest picture read at all, to be drawn smaller. */
export const MAX_PICTURE_BYTES = 50 * 1000 * 1000;

/** The longest side an image is drawn at when it has to be made smaller. */
const MAX_SIDE = 2000;

/** The pictures one prompt carries. */
export const MAX_PICTURES = 10;

/** The text one prompt carries, in all its files: twice what one may hold. */
export const MAX_TEXT_BYTES = 2 * TEXT_ATTACHMENT_LIMIT;

/** What the files are attached to: a chat's prompt, or the look page's, which takes pictures. */
export type Takes = "files" | "pictures";

/** What a set of files became: the chips to attach, and a sentence for each that could not be. */
export interface Attached<C extends Chip = Chip> {
  readonly chips: readonly C[];
  readonly refused: readonly string[];
}

/** The image files a paste carries; none for a paste of text alone. */
export const pastedImages = (data: DataTransfer | null): File[] =>
  [...(data?.files ?? [])].filter((file) => file.type.startsWith("image/"));

/** Whether a drag carries files from the desktop, rather than a layer, a component or text. */
export const dragsFiles = (data: DataTransfer | null) =>
  data?.types.includes("Files") === true;

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

/** A file's size as a person reads it, rounded up so a file over a limit reads over it: `840 B`, `13 KB`, `3.4 MB`. */
export const sizeLabel = (bytes: number) => {
  if (bytes < 1000) {
    return `${bytes} B`;
  }
  if (bytes < 1_000_000) {
    return `${Math.ceil(bytes / 1000)} KB`;
  }
  const mb = bytes / 1_000_000;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
};

/** What a file too large or of another kind is told to become: the agent reads it from the project. */
const INSTEAD = "Put it in the project’s folder and name it in the prompt.";

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

/**
 * The bytes as text; `binary` when they hold a NUL, as binaries do, and `encoding` when they are
 * text in another encoding than UTF-8. `partial` bytes are a file's start, which may end inside a
 * character.
 */
const textOf = (
  bytes: Uint8Array,
  partial = false
): { text: string } | "binary" | "encoding" => {
  if (bytes.includes(0)) {
    return "binary";
  }
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes, {
        stream: partial,
      }),
    };
  } catch {
    // Not UTF-8: refused, rather than sent as noise.
    return "encoding";
  }
};

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/** The start of a file too large to read whole, enough to tell text from a binary. */
const SNIFF_BYTES = 4096;

/** A text file read whole, or why it is not attached. */
const readText = async (file: File): Promise<TextChip | string> => {
  const { name } = file;
  if (file.size > TEXT_ATTACHMENT_LIMIT) {
    const head = textOf(await bytesOf(file.slice(0, SNIFF_BYTES)), true);
    return head === "binary"
      ? notTaken(name)
      : `${name} is ${sizeLabel(file.size)}, over the ${sizeLabel(TEXT_ATTACHMENT_LIMIT)} a text file can be. ${INSTEAD}`;
  }
  const read = textOf(await bytesOf(file));
  if (read === "binary") {
    return notTaken(name);
  }
  return read === "encoding"
    ? `${name} isn’t UTF-8 text. Save it as UTF-8 and attach it again.`
    : textChip(name, read.text);
};

const notTaken = (name: string) =>
  `${name} can’t be attached: an agent reads pictures and text files. ${INSTEAD}`;

const FIG_RE = /\.fig$/i;

/** What one file becomes: its chip, or the sentence saying why it is not attached. */
const readFile = async (
  file: File,
  takes: Takes
): Promise<ImageChip | TextChip | string> => {
  const name = pastedName(file);
  if (file.type.startsWith("image/")) {
    if (file.size > MAX_PICTURE_BYTES) {
      return `${name} is ${sizeLabel(file.size)}, over the ${sizeLabel(MAX_PICTURE_BYTES)} a picture can be. Export it smaller and attach it again.`;
    }
    const dataUrl = await dataUrlOf(file).catch(() => null);
    return dataUrl
      ? imageChip(name, dataUrl)
      : `${name} couldn’t be read as a picture. Save it as PNG or JPEG and attach it again.`;
  }
  if (takes === "pictures") {
    return `${name} isn’t a picture. Describe the look, name a site or add a picture.`;
  }
  if (FIG_RE.test(name)) {
    return `${name} is a Figma file: bring it in with Import a .fig file… in the + menu.`;
  }
  return await readText(file);
};

/** Reads `files`, in their order, into chips and the reasons the rest are not attached. */
export const readFiles = async (
  files: readonly File[],
  takes: Takes
): Promise<Attached<ImageChip | TextChip>> => {
  const read = await Promise.all(files.map((file) => readFile(file, takes)));
  return {
    chips: read.filter((r): r is ImageChip | TextChip => typeof r !== "string"),
    refused: read.filter((r): r is string => typeof r === "string"),
  };
};

const textBytes = (chips: readonly Chip[]) =>
  chips.reduce((sum, c) => sum + (c.kind === "text" ? c.size : 0), 0);

/**
 * The chips a prompt that already has `existing` can take on, in order, within its pictures and
 * its text; a sentence for each kind that did not fit.
 */
export const admit = <C extends Chip>(
  existing: readonly Chip[],
  incoming: readonly C[]
): Attached<C> => {
  let pictures = existing.filter((c) => c.kind === "image").length;
  let text = textBytes(existing);
  const chips: C[] = [];
  const over = { pictures: 0, text: 0 };
  for (const chip of incoming) {
    if (chip.kind === "image") {
      if (pictures >= MAX_PICTURES) {
        over.pictures += 1;
        continue;
      }
      pictures += 1;
    } else if (chip.kind === "text") {
      if (text + chip.size > MAX_TEXT_BYTES) {
        over.text += 1;
        continue;
      }
      text += chip.size;
    }
    chips.push(chip);
  }
  const refused = [
    over.pictures > 0 &&
      `A prompt takes up to ${MAX_PICTURES} pictures, so ${over.pictures === 1 ? "one wasn’t" : `${over.pictures} weren’t`} attached. Send these first, then attach the rest.`,
    over.text > 0 &&
      `A prompt takes up to ${sizeLabel(MAX_TEXT_BYTES)} of text files, so ${over.text === 1 ? "one wasn’t" : `${over.text} weren’t`} attached. ${INSTEAD}`,
  ].filter((line): line is string => typeof line === "string");
  return { chips, refused };
};

/** Says, in a toast each, why files were not attached. */
export const tellRefused = (refused: readonly string[]) => {
  for (const line of refused) {
    toast.error(line);
  }
};

/**
 * Attaches `files` to the thread's next prompt, in their order, beside what it already carries;
 * says which could not be, and why.
 */
export const attachFiles = async (threadId: string, files: readonly File[]) => {
  const read = await readFiles(files, "files");
  // Admitted against the chips as they are once read: another drop may have landed meanwhile.
  const existing = useAttachments.getState().byThread[threadId] ?? [];
  const admitted = admit(existing, read.chips);
  for (const chip of admitted.chips) {
    addChip(threadId, chip);
  }
  tellRefused([...read.refused, ...admitted.refused]);
};
