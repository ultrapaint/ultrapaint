import { describe, expect, it } from "vitest";
import { formatNodeRef, parseNodeRef } from "./node-ref.ts";

describe("node references", () => {
  it("read a route and a node id", () => {
    expect(parseNodeRef("/orders#c_8x2k1q")).toEqual({
      nodeId: "c_8x2k1q",
      route: "/orders",
    });
    expect(parseNodeRef("/invoices/:id#t_1")).toEqual({
      nodeId: "t_1",
      route: "/invoices/:id",
    });
  });

  it("read a canvas and the canvas", () => {
    expect(parseNodeRef("marketing:/pricing#r_2")).toEqual({
      canvas: "marketing",
      nodeId: "r_2",
      route: "/pricing",
    });
    expect(parseNodeRef("canvas#g_3")).toEqual({ nodeId: "g_3", route: null });
  });

  it("are not read out of anything else", () => {
    expect(parseNodeRef("c_8x2k1q")).toBeNull();
    expect(parseNodeRef("/orders")).toBeNull();
    expect(parseNodeRef("see /orders#x and more")).toBeNull();
  });

  it("come back as they were written", () => {
    for (const text of [
      "/orders#c_1",
      "canvas#g_3",
      "marketing:/pricing#r_2",
    ]) {
      const ref = parseNodeRef(text);
      expect(ref && formatNodeRef(ref)).toBe(text);
    }
  });
});
