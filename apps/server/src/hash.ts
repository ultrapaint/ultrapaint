import { createHash } from "node:crypto";
import type { ComponentFile } from "@ultrapaint/contracts/components";

export const hashContent = (content: string): string =>
  createHash("sha1").update(content).digest("hex").slice(0, 16);

/** A file's contents by their hash: SHA-256, in hex. */
export const hashBytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export const toPosix = (p: string) => p.replaceAll("\\", "/");

/** JSON with every object's keys in order: the same design always hashes the same. */
export const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b)
          )
        )
      : v
  );

/** What a component's file hashes to: the design's side of its binding (ADR 0030). */
export const componentHash = (component: ComponentFile): string =>
  hashContent(stableJson(component));
