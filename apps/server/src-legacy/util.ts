import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const hashContent = (content: string): string =>
  createHash("sha1").update(content).digest("hex").slice(0, 16);

/** Writes through a temporary sibling and renames so readers never see a partial file. */
export const writeAtomic = (file: string, content: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
};

/** Serialises async work per key so two writers never interleave on one file. */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(work, work);
    this.tails.set(
      key,
      next.catch(() => undefined)
    );
    return next;
  }
}

export const toPosix = (p: string) => p.replaceAll("\\", "/");
