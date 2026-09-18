import type {
  Mounted,
  RouterBridge,
  RouterInput,
} from "@ultrapaint/framework-api/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeRouter } from "./router.ts";

const loader = (path: string) => () => Promise.resolve({ default: path });

const modules = {
  "../index.tsx": loader("index"),
  "../marketing/index.tsx": loader("marketing index"),
  "../marketing/pricing.tsx": loader("marketing pricing"),
  "../settings/billing.tsx": loader("billing"),
};

/** Two spaces: the designs root, and `marketing` inside it. */
const spaceFiles = ["../space.json", "../marketing/space.json"];

const setup = (space: string, route: string) => {
  const post = vi.fn();
  const shown: (string | null)[] = [];
  const mount = vi.fn((input: { page: { path: string } | null }) => {
    shown.push(input.page?.path ?? null);
    return {
      unmount: vi.fn(),
      update: (next: { page: { path: string } | null }) => {
        shown.push(next.page?.path ?? null);
      },
    } as unknown as Mounted;
  });
  const router = makeRouter({
    post,
    reportError: vi.fn(),
    route,
    space,
    standalone: false,
  });
  router.start({
    base: "../",
    canvas: {} as HTMLElement,
    modules,
    mount,
    providers: undefined,
    spaceFiles,
  } as unknown as RouterInput);
  return { post, router, shown };
};

const bridge = () =>
  (globalThis.window as unknown as { __ED_ROUTER__: RouterBridge })
    .__ED_ROUTER__;

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {};
});

describe("the router of a space", () => {
  it("shows the page of the route the editor opened it at", () => {
    const { shown } = setup("", "/settings/billing");
    expect(shown.at(-1)).toBe("settings/billing.tsx");
  });

  it("only sees the pages of its own space", () => {
    // `/pricing` is a page of `marketing`, which this space may not reach.
    const { shown } = setup("", "/pricing");
    expect(shown.at(-1)).toBeNull();
    expect(setup("marketing", "/pricing").shown.at(-1)).toBe("pricing.tsx");
  });

  it("reads a nested space's pages relative to the space, not the designs root", () => {
    const { shown } = setup("marketing", "/");
    expect(shown.at(-1)).toBe("index.tsx");
  });

  it("asks the editor to navigate instead of moving itself", () => {
    const { post, shown } = setup("", "/");
    bridge().navigate("/settings/billing");
    expect(post).toHaveBeenCalledWith({
      replace: false,
      route: "/settings/billing",
      type: "ed:navigateTo",
    });
    // Nothing moved: the editor holds the route.
    expect(shown.at(-1)).toBe("index.tsx");
  });

  it("takes a page file as a navigation target", () => {
    const { post } = setup("", "/");
    bridge().navigate("settings/billing.tsx", { replace: true });
    expect(post).toHaveBeenCalledWith({
      replace: true,
      route: "/settings/billing",
      type: "ed:navigateTo",
    });
  });

  it("shows the page when the editor answers, and says where it is", () => {
    const { post, router, shown } = setup("", "/");
    router.setRoute("/settings/billing");
    expect(shown.at(-1)).toBe("settings/billing.tsx");
    expect(bridge().state().route).toBe("/settings/billing");
    expect(post).toHaveBeenCalledWith({
      page: "settings/billing.tsx",
      route: "/settings/billing",
      type: "ed:routeChanged",
    });
  });

  it("loads the space's other pages in the background, and only those", async () => {
    vi.useFakeTimers();
    const load = vi.fn(() => Promise.resolve({ default: null }));
    const router = makeRouter({
      post: vi.fn(),
      reportError: vi.fn(),
      route: "/",
      space: "",
      standalone: false,
    });
    router.start({
      base: "../",
      canvas: {} as HTMLElement,
      modules: {
        "../index.tsx": vi.fn(() => Promise.resolve({ default: null })),
        "../marketing/pricing.tsx": load,
        "../settings/billing.tsx": load,
      },
      mount: () =>
        ({ unmount: vi.fn(), update: vi.fn() }) as unknown as Mounted,
      providers: undefined,
      spaceFiles,
    } as unknown as RouterInput);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    // `settings/billing` is the only other page of this space; `index` is on screen.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("holds its own route when no editor is around it", () => {
    const post = vi.fn();
    const router = makeRouter({
      post,
      reportError: vi.fn(),
      route: "/",
      space: "",
      standalone: true,
    });
    router.start({
      base: "../",
      canvas: {} as HTMLElement,
      modules,
      mount: () =>
        ({ unmount: vi.fn(), update: vi.fn() }) as unknown as Mounted,
      providers: undefined,
      spaceFiles,
    } as unknown as RouterInput);
    bridge().navigate("/settings/billing");
    expect(bridge().state().route).toBe("/settings/billing");
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "ed:navigateTo" })
    );
  });
});
