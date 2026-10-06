import "../testing/fake-browser.ts";
import { describe, expect, it, vi } from "vitest";
import { useEditor } from "../state/editor.ts";
import { leaveHover } from "./use-frame-pointer.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

describe("leaveHover", () => {
  it("forgets the frame's hover and the lookup still on its way", () => {
    useEditor.setState({ hover: { frame: "p1", nodeId: "a" } });
    const asked = { current: 3 };
    leaveHover(asked, "p1");
    expect(useEditor.getState().hover).toBeNull();
    // The answer to lookup 3 no longer counts.
    expect(asked.current).toBe(4);
  });

  it("leaves another frame's hover alone", () => {
    useEditor.setState({ hover: { frame: "p2", nodeId: "a" } });
    leaveHover({ current: 0 }, "p1");
    expect(useEditor.getState().hover).toEqual({ frame: "p2", nodeId: "a" });
  });
});
