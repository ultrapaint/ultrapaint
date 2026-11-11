/**
 * Pictures and text files from disk attached to a prompt (ADR 0064), as chips: in a chat's
 * composer, the look page's agent box and the start screen's composer. Nothing of the editor's
 * state, so the start screen, which has no server, takes them as the chat does.
 */
import type { PromptAttachment } from "@ultrapaint/contracts/threads";

export interface ImageChip {
  readonly dataUrl: string;
  /** Tells two pictures apart, whatever their names. */
  readonly id: string;
  readonly kind: "image";
  readonly name: string;
}

export interface TextChip {
  /** Tells two files apart, whatever their names. */
  readonly id: string;
  readonly kind: "text";
  readonly name: string;
  /** Its size in bytes, as the chip's tooltip says it. */
  readonly size: number;
  readonly text: string;
}

/** A file from disk, attached. */
export type FileChip = ImageChip | TextChip;

let attached = 0;

const attachedId = () => {
  attached += 1;
  return `${Date.now()}-${attached}`;
};

/** The chip of a picture, as a data URL. */
export const imageChip = (name: string, dataUrl: string): ImageChip => ({
  dataUrl,
  id: attachedId(),
  kind: "image",
  name,
});

/** The chip of a text file, read. */
export const textChip = (name: string, text: string): TextChip => ({
  id: attachedId(),
  kind: "text",
  name,
  size: new TextEncoder().encode(text).length,
  text,
});

/** What the prompt carries for a file: the picture itself, or the file's text. */
export const attachmentOfFile = (chip: FileChip): PromptAttachment =>
  chip.kind === "image"
    ? { dataUrl: chip.dataUrl, kind: "image", name: chip.name }
    : { kind: "text", name: chip.name, text: chip.text };
