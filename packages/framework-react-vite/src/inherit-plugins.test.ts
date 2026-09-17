import { describe, expect, it } from "vitest";
import {
  flattenPlugins,
  has,
  REACT_PLUGIN_RE,
  splitPlugins,
  TAILWIND_PLUGIN_RE,
} from "./inherit-plugins.ts";

describe("plugins inherited from the anchor's Vite config", () => {
  it("flattens nested arrays, promises and placeholders", async () => {
    const plugins = await flattenPlugins([
      { name: "a" },
      [{ name: "b" }, false, null, Promise.resolve([{ name: "c" }])],
      undefined,
    ]);
    expect(plugins.map((p) => p.name)).toEqual(["a", "b", "c"]);
  });

  it("keeps what shapes the modules and drops what runs the application", () => {
    const { dropped, kept } = splitPlugins(
      [
        "vite:react-babel",
        "@tailwindcss/vite:scan",
        "vite-tsconfig-paths",
        "vite-plugin-svgr",
        "lingui",
        "tanstack-start-core:config",
        "vite-plugin-cloudflare",
        "sentry-vite-plugin",
        "epicparty-prime-web-app:validate-env",
        "vite-plugin-pwa",
      ].map((name) => ({ name }))
    );
    expect(kept.map((p) => p.name)).toEqual([
      "vite:react-babel",
      "@tailwindcss/vite:scan",
      "vite-tsconfig-paths",
      "vite-plugin-svgr",
      "lingui",
    ]);
    expect(dropped).toHaveLength(5);
  });

  it("recognises the React and Tailwind plugins, so they are not added twice", () => {
    const plugins = [
      { name: "vite:react-swc" },
      { name: "@tailwindcss/vite:scan" },
    ];
    expect(has(plugins, REACT_PLUGIN_RE)).toBe(true);
    expect(has(plugins, TAILWIND_PLUGIN_RE)).toBe(true);
    expect(has([{ name: "other" }], REACT_PLUGIN_RE)).toBe(false);
  });
});
