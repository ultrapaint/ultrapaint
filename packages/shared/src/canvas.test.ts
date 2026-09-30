import { describe, expect, it } from "vitest";
import {
  canvasIdOf,
  canvasIdsFrom,
  orderCanvases,
  pathInCanvas,
  ROOT_CANVAS,
} from "./canvas.ts";

describe("canvases from the files of the designs directory", () => {
  it("makes a canvas of every directory with a canvas.json", () => {
    expect(
      canvasIdsFrom([
        "wireframes/canvas.json",
        "canvas.json",
        "brand/canvas.json",
      ])
    ).toEqual(["", "brand", "wireframes"]);
  });

  it("gives a file to the innermost canvas that holds it", () => {
    const ids = ["", "app", "app/v2"];
    expect(canvasIdOf(ids, "home.page.json")).toBe(ROOT_CANVAS);
    expect(canvasIdOf(ids, "app/pricing.page.json")).toBe("app");
    expect(canvasIdOf(ids, "app/v2/pricing.page.json")).toBe("app/v2");
    // Without canvas.json anywhere, the designs directory is the one canvas.
    expect(canvasIdOf([], "deep/down.page.json")).toBe(ROOT_CANVAS);
    // With canvases and none at the root, a file beside them has no canvas.
    expect(canvasIdOf(["app"], "loose.page.json")).toBeNull();
  });

  it("reads a page's path inside its canvas", () => {
    expect(pathInCanvas("app", "app/settings/billing.page.json")).toBe(
      "settings/billing.page.json"
    );
    expect(pathInCanvas(ROOT_CANVAS, "home.page.json")).toBe("home.page.json");
  });

  it("lists them in the order kept, then the rest by id", () => {
    const canvases = [
      { id: "" },
      { id: "brand" },
      { id: "wireframes" },
      { id: "app" },
    ];
    expect(
      orderCanvases(canvases, ["wireframes", "gone", ""]).map((c) => c.id)
    ).toEqual(["wireframes", "", "app", "brand"]);
  });
});
