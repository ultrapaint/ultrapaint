import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { parseSourceKey, sourceKey } from "./base.ts";
import { decodeClientFrame, requests } from "./ipc.ts";
import { Settings } from "./settings.ts";

describe("ipc", () => {
  it("decodes a valid client frame", () => {
    const r = decodeClientFrame({ id: 1, input: undefined, method: "health" });
    expect(Result.isSuccess(r)).toBe(true);
  });

  it("accepts a frame without input, as JSON drops undefined", () => {
    const r = decodeClientFrame(JSON.parse('{"id":1,"method":"health"}'));
    expect(Result.isSuccess(r)).toBe(true);
  });

  it("rejects a malformed frame", () => {
    const r = decodeClientFrame({ method: "health" });
    expect(Result.isFailure(r)).toBe(true);
  });

  it("rejects bad request input with a typed error", () => {
    const decode = Schema.decodeUnknownResult(requests["settings.set"].input);
    const r = decode({ repoPath: 1 });
    expect(Result.isFailure(r)).toBe(true);
  });

  it("round-trips settings", () => {
    const s: Settings = {
      componentPackages: [],
      designsDir: "designs",
      hostCss: [],
      libraryDirs: [],
      repoPath: "/tmp/repo",
      theme: "light",
    };
    expect(Schema.decodeUnknownSync(Settings)(s)).toEqual(s);
  });

  it("source keys round-trip", () => {
    const loc = { col: 4, file: "products/prime/designs/a.tsx", line: 12 };
    expect(parseSourceKey(sourceKey(loc))).toEqual(loc);
  });
});
