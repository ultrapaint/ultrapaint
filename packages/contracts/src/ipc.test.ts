import { Schema as S } from "effect";
import { describe, expect, it } from "vitest";
import { parseSourceKey, sourceKey } from "./base.ts";
import { decodeClientFrame, requests } from "./ipc.ts";
import { Settings } from "./settings.ts";

describe("ipc", () => {
  it("decodes a valid client frame", () => {
    const r = decodeClientFrame({ id: 1, input: undefined, method: "health" });
    expect(r._tag).toBe("Right");
  });

  it("rejects a malformed frame", () => {
    const r = decodeClientFrame({ method: "health" });
    expect(r._tag).toBe("Left");
  });

  it("rejects bad request input with a typed error", () => {
    const decode = S.decodeUnknownEither(requests["settings.set"].input);
    const r = decode({ repoPath: 1 });
    expect(r._tag).toBe("Left");
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
    expect(S.decodeUnknownSync(Settings)(s)).toEqual(s);
  });

  it("source keys round-trip", () => {
    const loc = { col: 4, file: "products/prime/designs/a.tsx", line: 12 };
    expect(parseSourceKey(sourceKey(loc))).toEqual(loc);
  });
});
