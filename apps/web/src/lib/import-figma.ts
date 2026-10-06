/**
 * Bringing a Figma file in: the bytes go to the server over HTTP (the RPC socket carries JSON,
 * and a design file runs to tens of megabytes), and the Sync view opens on it: Figma's tokens
 * are compared with the code's first, then an agent turns the frames into pages (ADR 0025).
 */

import { type FigmaImport, MAX_FIG_BYTES } from "@ultrapaint/contracts/figma";
import { toast } from "sonner";
import { showSetup } from "../state/design-system-setup.ts";
import { ensureEditable } from "../state/setup.ts";
import { useSync } from "../state/sync.ts";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const upload = async (file: File): Promise<FigmaImport> => {
  const response = await fetch("/api/figma/import", {
    body: file,
    headers: {
      "content-type": "application/octet-stream",
      "x-file-name": encodeURIComponent(file.name),
    },
    method: "POST",
  });
  const body = (await response.json()) as FigmaImport | { message: string };
  if (!(response.ok && "id" in body)) {
    throw new Error("message" in body ? body.message : "the import failed");
  }
  return body;
};

/** Reads the file on the server, then opens a thread to convert it. */
export const importFigma = async (file: File) => {
  if (!ensureEditable({ designSystem: false })) {
    return;
  }
  // Checked here: the server refuses a larger body by closing the connection before it has
  // read it, which the browser reports as a network failure rather than the server's message.
  if (file.size > MAX_FIG_BYTES) {
    toast.error(
      `${file.name} is larger than ${MAX_FIG_BYTES / 1024 / 1024} MB, the most a Figma import accepts.`
    );
    return;
  }
  const id = toast.loading(`Reading ${file.name}…`);
  try {
    const imported = await upload(file);
    const frames = imported.pages.reduce((n, p) => n + p.frames.length, 0);
    toast.success(
      `${file.name}: ${frames} frame${frames === 1 ? "" : "s"}, ${imported.components.length} component${imported.components.length === 1 ? "" : "s"}. Sync takes its tokens, then its frames.`,
      { id }
    );
    showSetup();
    await useSync.getState().load();
  } catch (error) {
    toast.error(messageOf(error), { id });
  }
};

/** Asks for a `.fig` file, from wherever the import is offered, and imports it. */
export const pickFigmaFile = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".fig";
  input.addEventListener("change", () => {
    const [file] = input.files ?? [];
    if (file) {
      importFigma(file);
    }
  });
  input.click();
};
