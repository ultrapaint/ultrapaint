import { createHash } from "node:crypto";
import type { ComponentFile } from "@ultrapaint/contracts/components";
import { Predicate } from "effect";

export const hashContent = (content: string): string =>
  createHash("sha1").update(content).digest("hex").slice(0, 16);

/** A file's contents by their hash: SHA-256, in hex. */
export const hashBytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export const toPosix = (p: string) => p.replaceAll("\\", "/");

/**
 * The order of what is written to a committed file or hashed: English's, on every machine. The
 * machine's own language would put `y` before `x` (Lithuanian), `zIndex` before `text`
 * (Estonian) or `aa` last (Danish), and two teammates would write the same file differently.
 */
export const inEnglish = (a: string, b: string): number =>
  a.localeCompare(b, "en");

/**
 * A record with its keys in order: the same record always writes the same, and a file of it
 * that is committed diffs and merges line by line.
 */
export const sortedByKey = <A>(
  record: Readonly<Record<string, A>>
): Record<string, A> =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => inEnglish(a, b))
  );

/** JSON with every object's keys in order: the same design always hashes the same. */
export const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    Predicate.isObject(v) ? sortedByKey(v) : v
  );

/** What a component's file hashes to: the design's side of its binding (ADR 0030). */
export const componentHash = (component: ComponentFile): string =>
  hashContent(stableJson(component));
