import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { CanvasId, FileId } from "./base.ts";

const isFileId = Schema.is(FileId);
const isCanvasId = Schema.is(CanvasId);

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
});
