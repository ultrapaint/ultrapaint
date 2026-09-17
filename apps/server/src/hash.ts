import { createHash } from "node:crypto";

export const hashContent = (content: string): string =>
  createHash("sha1").update(content).digest("hex").slice(0, 16);

export const toPosix = (p: string) => p.replaceAll("\\", "/");
