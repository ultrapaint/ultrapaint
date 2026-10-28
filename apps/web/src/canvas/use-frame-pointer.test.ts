import "../testing/fake-browser.ts";
import { describe, expect, it, vi } from "vitest";
import { useEditor } from "../state/editor.ts";
import { leaveHover } from "./use-frame-pointer.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

describe("leaveHover", () => {
  it("forgets the frame's hover", () => {
    useEditor.setState({ hover: { frame: "p1", nodeId: "a" } });
    leaveHover("p1");
    expect(useEditor.getState().hover).toBeNull();
  });

  it("leaves another frame's hover alone", () => {
    useEditor.setState({ hover: { frame: "p2", nodeId: "a" } });
    leaveHover("p1");
    expect(useEditor.getState().hover).toEqual({ frame: "p2", nodeId: "a" });
  });
});
