import { createHash } from "node:crypto";

export const hashContent = (content: string): string =>
  createHash("sha1").update(content).digest("hex").slice(0, 16);

/** A file's contents by their hash: SHA-256, in hex. */
export const hashBytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export const toPosix = (p: string) => p.replaceAll("\\", "/");
