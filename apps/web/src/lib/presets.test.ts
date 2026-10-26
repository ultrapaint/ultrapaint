import { presetSize } from "@ultrapaint/contracts/pages";
import { describe, expect, it } from "vitest";
import { pageEntries } from "./menu-model.ts";
import {
  parseDevice,
  presetOf,
  prototypeDevices,
  sizeForPreset,
  viewportPresets,
} from "./presets.ts";

describe("the viewport presets", () => {
  it("offer the devices and Custom, in that order", () => {
    expect(viewportPresets.map((p) => p.value)).toEqual([
      "mobile",
      "tablet",
      "desktop",
      "custom",
    ]);
  });

  it("call a frame without a preset of its own custom", () => {
    expect(presetOf({ preset: "tablet" })).toBe("tablet");
    expect(presetOf({})).toBe("custom");
    expect(presetOf(undefined)).toBe("custom");
  });

  it("keep the frame's size when Custom is chosen", () => {
    const current = { height: 500, width: 700 };
    expect(sizeForPreset("custom", current)).toEqual(current);
    expect(sizeForPreset("mobile", current)).toEqual(presetSize.mobile);
  });

  it("check Custom in the page menu when the frame is custom", () => {
    const entries = pageEntries({
      canPaste: false,
      canvases: [],
      count: 1,
      implementation: "draft" as const,
      name: "Home",
      onCanvas: true,
      preset: "custom",
      statesFree: [],
      variantsFree: [],
    });
    const submenu = entries.find(
      (e) => e.kind === "submenu" && e.id === "preset"
    );
    const items =
      submenu?.kind === "submenu"
        ? submenu.entries.flatMap((e) =>
            e.kind === "item" ? [{ checked: e.checked, id: e.id }] : []
          )
        : [];
    expect(items).toEqual([
      { checked: false, id: "preset:mobile" },
      { checked: false, id: "preset:tablet" },
      { checked: false, id: "preset:desktop" },
      { checked: true, id: "preset:custom" },
    ]);
  });
});

describe("the prototype's devices", () => {
  it("are the presets without Custom", () => {
    expect(prototypeDevices.map((d) => d.value)).toEqual([
      "mobile",
      "tablet",
      "desktop",
    ]);
  });

  it("read back what was stored, and the desktop for anything else", () => {
    expect(parseDevice("tablet")).toBe("tablet");
    expect(parseDevice("frame")).toBe("desktop");
    expect(parseDevice("custom")).toBe("desktop");
    expect(parseDevice(null)).toBe("desktop");
  });
});
