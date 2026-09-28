import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { nodeFromText, textOfNode } from "./node-text.ts";

const card: DesignNode = {
  children: [{ id: "t1", role: "paragraph", text: "Hi", type: "text" }],
  gap: 8,
  id: "c1",
  type: "column",
};

describe("nodes on the clipboard", () => {
  it("come back as they were copied", () => {
    expect(nodeFromText(textOfNode(card))).toEqual(card);
  });

  it("are not read out of any other text", () => {
    expect(nodeFromText("Hello")).toBeNull();
    expect(nodeFromText(JSON.stringify(card))).toBeNull();
    expect(nodeFromText('{"ultrapaint/node": ')).toBeNull();
  });

  it("are checked against the format", () => {
    expect(
      nodeFromText(JSON.stringify({ "ultrapaint/node": { id: "x" } }))
    ).toBeNull();
  });
});
