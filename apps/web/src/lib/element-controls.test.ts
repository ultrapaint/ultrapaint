import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import {
  controlsOf,
  propValue,
  SHOWN_PROPS,
  tokenLabel,
} from "./element-controls.ts";

const instance = {
  component: "Table",
  from: "ui/table",
  id: "i_1",
  type: "instance",
} as DesignNode;

describe("controlsOf", () => {
  it("shows two props of a component and keeps the rest behind + n", () => {
    const { more, shown } = controlsOf(instance, {
      density: ["compact", "comfortable"],
      size: ["sm", "md", "lg"],
      tone: ["plain"],
      variant: ["default", "striped"],
    });
    expect(shown).toHaveLength(SHOWN_PROPS);
    expect(shown.map((c) => (c.kind === "prop" ? c.name : c.kind))).toEqual([
      "density",
      "size",
    ]);
    // A variant with one member offers no choice.
    expect(more.map((c) => (c.kind === "prop" ? c.name : c.kind))).toEqual([
      "variant",
    ]);
  });

  it("offers a text its style, colour and alignment", () => {
    const text = {
      id: "t_1",
      role: "paragraph",
      text: "Hi",
      type: "text",
    } as DesignNode;
    expect(controlsOf(text, undefined).shown.map((c) => c.kind)).toEqual([
      "textStyle",
      "token",
      "align",
    ]);
  });

  it("gives a container its tokens, and a group no gap", () => {
    const row = { children: [], id: "r_1", type: "row" } as DesignNode;
    const group = { children: [], id: "g_1", type: "group" } as DesignNode;
    const fields = (n: DesignNode) =>
      controlsOf(n, undefined).shown.map((c) =>
        c.kind === "token" ? c.field : c.kind
      );
    expect(fields(row)).toEqual(["fill", "radius", "padding", "gap", "shadow"]);
    expect(fields(group)).not.toContain("gap");
  });
});

describe("propValue", () => {
  it("reads what the node sets, else falls back on default, else the first", () => {
    expect(propValue({ size: "lg" }, "size", ["sm", "lg"])).toBe("lg");
    expect(propValue({}, "variant", ["outline", "default"])).toBe("default");
    expect(propValue(undefined, "size", ["sm", "lg"])).toBe("sm");
  });
});

describe("tokenLabel", () => {
  it("names tokens briefly and spacing by its step", () => {
    expect(tokenLabel("fill", "$color-card", 4)).toBe("card");
    expect(tokenLabel("radius", "$radius-lg", 4)).toBe("lg");
    expect(tokenLabel("padding", 16, 4)).toBe("4");
    expect(tokenLabel("gap", 6, 4)).toBe("1.5");
    expect(tokenLabel("gap", 7, 4)).toBe("7px");
    expect(tokenLabel("padding", { top: 4 }, 4)).toBe("mixed");
    expect(tokenLabel("shadow", undefined, 4)).toBe("none");
  });
});
