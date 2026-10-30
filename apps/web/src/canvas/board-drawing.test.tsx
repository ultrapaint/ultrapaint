// @vitest-environment happy-dom

import type { SystemComponentFile } from "@ultrapaint/contracts/components";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  FrameRuntime,
  Preview,
  RenderRequest,
} from "@ultrapaint/preview-core/preview";
import { catalogueOf } from "@ultrapaint/system-components/catalogue";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardPlace } from "../state/board.ts";
import { useComponents } from "../state/components.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { BoardCanvas } from "./board-canvas.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

/** The preview `usePreview` answers: the one the test gives. */
const current = vi.hoisted(() => {
  let preview: Preview | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => preview,
    set: (next: Preview | null) => {
      preview = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});
vi.mock("./preview-module.ts", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePreview: () => useSyncExternalStore(current.subscribe, current.get),
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A preview whose frames keep what they are told to draw, by frame. */
const fakePreview = () => {
  const renders: { frame: string; request: RenderRequest }[] = [];
  const preview = {
    fromFrame: () => false,
    mountFrame: (_host, options) =>
      ({
        editText: () => undefined,
        hitTest: () => [],
        measure: () => ({}),
        render: (request: RenderRequest) => {
          renders.push({ frame: options.frame, request });
        },
        screenshot: () => Promise.resolve(null),
        scrollIntoView: () => undefined,
        show: () => undefined,
        skeleton: () => undefined,
        unmount: () => undefined,
        watchRects: () => undefined,
      }) satisfies FrameRuntime,
    setLook: () => undefined,
  } satisfies Preview;
  return { preview, renders };
};

const ds = {
  colors: [
    {
      name: "primary",
      tokens: [{ name: "color-primary-600", value: "#2563eb" }],
    },
  ],
  radius: [],
  shadows: [],
  spacing: { base: "0.25rem" },
  themes: ["light", "dark"],
  typography: {
    fonts: [],
    sizes: [{ name: "text-sm", value: "0.875rem" }],
    styles: [],
    weights: [],
  },
  version: 1,
} as unknown as DesignSystem;

let root: Root | null = null;

const show = (element: ReactNode) => {
  if (!root) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  const r = root;
  act(() => r.render(element));
};

const setPreview = (preview: Preview | null) => act(() => current.set(preview));

/** The ids of a drawn tree's nodes, depth first. */
const idsOf = (request: RenderRequest | undefined): string[] => {
  const ids: string[] = [];
  const walk = (node: { children?: readonly unknown[]; id: string }) => {
    ids.push(node.id);
    for (const child of node.children ?? []) {
      walk(child as { children?: readonly unknown[]; id: string });
    }
  };
  if (request?.root) {
    walk(request.root as { id: string });
  }
  return ids;
};

const BUTTON: BoardPlace = { item: "Button", view: "library" };

beforeEach(() => {
  useDesignSystem.setState({ designSystem: ds });
  useComponents.setState({ catalogue: catalogueOf([]), components: [] });
});

afterEach(() => {
  const r = root;
  root = null;
  act(() => r?.unmount());
  setPreview(null);
});

describe("a board's drawing", () => {
  it("draws a system component's boards, each once, its matrix's cells named for their place", () => {
    const { preview, renders } = fakePreview();
    setPreview(preview);
    show(<BoardCanvas open={BUTTON} />);
    expect(renders.map((r) => r.frame)).toEqual([
      "board:library/Button/matrix",
      "board:library/Button/axis-size",
    ]);
    const matrix = renders[0]?.request;
    expect(idsOf(matrix)).toContain("cell:variant=outline:hover");
    // The grid the matrix is laid out in is the board's own stylesheet.
    expect(matrix?.css).toContain("display: grid");

    // Drawn again with the same boards: nothing changed, nothing is drawn.
    show(<BoardCanvas open={BUTTON} />);
    expect(renders).toHaveLength(2);
  });

  it("draws its boards again when the component's file changes", () => {
    const { preview, renders } = fakePreview();
    setPreview(preview);
    show(<BoardCanvas open={BUTTON} />);
    const before = renders.length;
    const saved = defaultLookOf("Button") as SystemComponentFile;
    const button: SystemComponentFile = {
      ...saved,
      variants: {
        ...saved.variants,
        variant: {
          ...saved.variants.variant,
          brand: { root: { fill: "#f00" } },
        },
      },
    };
    act(() => useComponents.setState({ components: [button] }));
    const drawn = renders.slice(before);
    expect(drawn.map((r) => r.frame)).toEqual([
      "board:library/Button/matrix",
      "board:library/Button/axis-size",
    ]);
    // A member the file adds is a row of the matrix.
    expect(idsOf(drawn[0]?.request)).toContain("cell:variant=brand:base");
  });

  it("draws Color a board a theme, each in its own", () => {
    const { preview, renders } = fakePreview();
    setPreview(preview);
    show(<BoardCanvas open={{ item: "color", view: "system" }} />);
    expect(renders.map((r) => r.request.defaults?.theme)).toEqual([
      "light",
      "dark",
    ]);
    expect(idsOf(renders[0]?.request)).toContain("token:color-primary-600");
  });
});
