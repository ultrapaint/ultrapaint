import { describe, expect, it } from "vitest";
import {
  requestDiff,
  takeDiffRequest,
  useDiffRequest,
} from "./diff-request.ts";

describe("diff requests", () => {
  it("waits for the Changes panel, which takes it once", () => {
    requestDiff("src/app.tsx");
    requestDiff("src/page.tsx");
    // Asked before the panel opened: the last file asked for is still there for it.
    expect(useDiffRequest.getState().path).toBe("src/page.tsx");
    takeDiffRequest();
    expect(useDiffRequest.getState().path).toBeNull();
  });
});
