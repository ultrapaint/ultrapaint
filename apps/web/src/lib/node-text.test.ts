import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { nodesFromText, textOfNodes } from "./node-text.ts";

const card: DesignNode = {
  children: [{ id: "t1", role: "paragraph", text: "Hi", type: "text" }],
  gap: 8,
  id: "c1",
  type: "column",
};
const note: DesignNode = {
  id: "t2",
  role: "paragraph",
  text: "Bye",
  type: "text",
};

describe("nodes on the clipboard", () => {
  it("come back as they were copied", () => {
    expect(nodesFromText(textOfNodes([card]))).toEqual([card]);
  });

  it("come back together when several were copied, in their order", () => {
    expect(nodesFromText(textOfNodes([card, note]))).toEqual([card, note]);
  });

  it("write one node on its own, as before", () => {
    expect(JSON.parse(textOfNodes([card]))).toEqual({
      "ultrapaint/node": card,
    });
  });

  it("are not read out of any other text", () => {
    expect(nodesFromText("Hello")).toBeNull();
    expect(nodesFromText(JSON.stringify(card))).toBeNull();
    expect(nodesFromText('{"ultrapaint/node": ')).toBeNull();
    expect(
      nodesFromText(JSON.stringify({ "ultrapaint/node": [] }))
    ).toBeNull();
  });

  it("are checked against the format", () => {
    expect(
      nodesFromText(JSON.stringify({ "ultrapaint/node": { id: "x" } }))
    ).toBeNull();
    expect(
      nodesFromText(JSON.stringify({ "ultrapaint/node": [card, { id: "x" }] }))
    ).toBeNull();
  });
});
