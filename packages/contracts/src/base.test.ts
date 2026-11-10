import { describe, expect, it } from "@effect/vitest";
import { CANVAS_ID_PATTERN } from "@ultrapaint/shared/node-ref";
import { Schema } from "effect";
import { CanvasId, FileId, RepoRelativePath } from "./base.ts";

const isFileId = Schema.is(FileId);
const isCanvasId = Schema.is(CanvasId);
const isRepoRelativePath = Schema.is(RepoRelativePath);

describe("RepoRelativePath", () => {
  it("takes a path inside the repository", () => {
    for (const path of ["", ".", "docs/designs", "apps/web/src/app.tsx"]) {
      expect(isRepoRelativePath(path), path).toBe(true);
    }
  });

  it("refuses a path that climbs out or starts at the root, on any line of it", () => {
    for (const path of [
      "..",
      "a/../b",
      "/etc",
      "a\0b",
      "a\n/../../etc/passwd",
    ]) {
      expect(isRepoRelativePath(path), JSON.stringify(path)).toBe(false);
    }
  });
});

describe("FileId", () => {
  it("takes the ids the server makes", () => {
    expect(isFileId("thread_lx3k9a_4f2k1")).toBe(true);
    expect(isFileId("fig_lx3k9a_00001")).toBe(true);
  });

  it("refuses anything that names another path", () => {
    for (const id of ["", ".", "..", "../settings", "a/b", "a\\b", "/etc"]) {
      expect(isFileId(id), id).toBe(false);
    }
  });
});

describe("CanvasId", () => {
  it("takes the designs directory and directories inside it", () => {
    for (const id of ["", "onboarding", "flows/sign in", "Café", "v2.1"]) {
      expect(isCanvasId(id), id).toBe(true);
    }
  });

  it("refuses a path that climbs out, starts at the root or hides", () => {
    for (const id of [
      "..",
      "../..",
      "a/../..",
      "a/..",
      "/etc",
      "a//b",
      "a/",
      ".git",
      "a\\..\\b",
      "a\0b",
    ]) {
      expect(isCanvasId(id), id).toBe(false);
    }
  });

  it("is what a reference writes before a page, but for whitespace, a colon and the designs directory", () => {
    const written = new RegExp(`^${CANVAS_ID_PATTERN}$`);
    for (const id of [
      "onboarding",
      "flows/sign-in",
      "Café",
      "v2.1",
      "a#b",
      "..",
      "a/..",
      "/etc",
      "a//b",
      "a/",
      ".git",
      "a/.git",
      "a\\b",
      "a\0b",
    ]) {
      expect(written.test(id), id).toBe(isCanvasId(id));
    }
    // A reference ends at whitespace and its canvas at the colon; it names the designs directory by no canvas.
    for (const id of ["flows/sign in", "a:b", ""]) {
      expect(isCanvasId(id), id).toBe(true);
      expect(written.test(id), id).toBe(false);
    }
  });
});
