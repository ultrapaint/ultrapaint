// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { addedNow, moduleEnds, moduleStarts } from "./hmr-leftovers.ts";

const URL_V0 = "http://127.0.0.1:4601/preview/src/analytics.ts";
const URL_V5 = `${URL_V0}?t=5`;

describe("what a module's top-level code adds", () => {
  it("goes when a newer version of the module runs, and only then", () => {
    const first = vi.fn();
    moduleStarts(URL_V0);
    addedNow(first);
    moduleEnds(URL_V0);
    const outside = vi.fn();
    addedNow(outside);

    const second = vi.fn();
    moduleStarts(URL_V5);
    expect(first).toHaveBeenCalledOnce();
    addedNow(second);
    moduleEnds(URL_V5);

    // The same version run again (another frame importing it) takes nothing off.
    moduleStarts(URL_V5);
    moduleEnds(URL_V5);
    expect(second).not.toHaveBeenCalled();
    expect(outside).not.toHaveBeenCalled();
  });
});
