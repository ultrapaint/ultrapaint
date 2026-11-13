// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  applyPreferences,
  DEFAULT_PREFERENCES,
  readPreferences,
} from "./preferences.ts";

describe("the person's preferences", () => {
  it("are the defaults when nothing was kept, or something unreadable", () => {
    expect(readPreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences("not json")).toEqual(DEFAULT_PREFERENCES);
  });

  it("keep each value only when it is one of its choices", () => {
    expect(
      readPreferences(
        JSON.stringify({
          accent: "teal",
          motion: "sideways",
          textSize: "large",
        })
      )
    ).toEqual({ ...DEFAULT_PREFERENCES, accent: "teal", textSize: "large" });
  });

  it("are drawn on the root, where the stylesheet reads them", () => {
    const root = document.createElement("html");
    applyPreferences(
      { ...DEFAULT_PREFERENCES, accent: "graphite", contrast: true },
      root
    );
    expect(root.dataset).toMatchObject({
      accent: "graphite",
      contrast: "more",
      motion: "system",
      textSize: "default",
    });
    applyPreferences(DEFAULT_PREFERENCES, root);
    expect(root.dataset.contrast).toBeUndefined();
  });
});
