// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { describe, expect, it, vi } from "vitest";
import { classValue } from "./element-toolbar-selects.tsx";
import { spacingClasses } from "./spacing-select.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

describe("the toolbar's values, as the classes they write", () => {
  it("read a padding the way Tailwind writes it, in steps of the scale", () => {
    expect(spacingClasses(16, "p", 4)).toBe("p-4");
    expect(spacingClasses({ left: 16, right: 16 }, "p", 4)).toBe("px-4");
    expect(
      spacingClasses({ bottom: 8, left: 16, right: 16, top: 8 }, "p", 4)
    ).toBe("px-4 py-2");
    expect(spacingClasses({ left: 4, top: 8 }, "m", 4)).toBe("mt-2 ml-1");
    expect(spacingClasses(undefined, "p", 4)).toBeNull();
  });

  it("put a length off the scale in brackets, and a token by its short name", () => {
    expect(classValue(13, 4, true)).toBe("[13px]");
    expect(classValue(12, 4, false)).toBe("[12px]");
    expect(classValue("$spacing-6", 4, true)).toBe("6");
    expect(classValue("#d4d4d8", 4, false)).toBe("[#d4d4d8]");
  });
});
