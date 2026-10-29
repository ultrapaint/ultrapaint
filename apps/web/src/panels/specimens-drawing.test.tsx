// @vitest-environment happy-dom

import {
  emptySystemComponent,
  type SystemComponentFile,
} from "@ultrapaint/contracts/components";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  FrameRuntime,
  Preview,
  RenderRequest,
} from "@ultrapaint/framework-api/browser";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComponents } from "../state/components.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { Matrix } from "./design-components.tsx";

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
vi.mock("../canvas/preview-module.ts", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePreview: () => useSyncExternalStore(current.subscribe, current.get),
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A preview whose frames keep what they are told to draw. */
const fakePreview = () => {
  const renders: RenderRequest[] = [];
  const preview = {
    fromFrame: () => false,
    mountFrame: () =>
      ({
        editText: () => undefined,
        hitTest: () => [],
        measure: () => ({}),
        render: (request: RenderRequest) => {
          renders.push(request);
        },
        screenshot: () => Promise.resolve(null),
        scrollIntoView: () => undefined,
        show: () => undefined,
        skeleton: () => undefined,
        tokens: () => ({}),
        unmount: () => undefined,
        watchRects: () => undefined,
      }) satisfies FrameRuntime,
  } satisfies Preview;
  return { preview, renders };
};

const ds = {
  colors: [],
  radius: [],
  shadows: [],
  spacing: { base: "0.25rem" },
  typography: {
    fonts: [],
    sizes: [{ name: "text-sm", value: "0.875rem" }],
    styles: [],
    weights: [],
  },
  version: 1,
} as unknown as DesignSystem;

const specOf = (component: string): SystemComponentFile =>
  emptySystemComponent(component);

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

beforeEach(() => {
  useDesignSystem.setState({ designSystem: ds });
  useComponents.setState({ components: [] });
});

afterEach(() => {
  const r = root;
  root = null;
  act(() => r?.unmount());
  setPreview(null);
});

describe("a specimen's drawing", () => {
  it("draws the matrix again when another component's file changes, and not for nothing", () => {
    const { preview, renders } = fakePreview();
    setPreview(preview);
    const button = specOf("Button");
    show(<Matrix component={button} meta={undefined} />);
    expect(renders).toHaveLength(1);
    expect(renders[0]?.components).toEqual([button]);

    // Drawn again with the same spec: nothing changed, nothing is drawn.
    show(<Matrix component={button} meta={undefined} />);
    expect(renders).toHaveLength(1);

    // A card drawn inside the button looks as its spec says.
    const card = specOf("Card");
    act(() => useComponents.setState({ components: [card] }));
    expect(renders).toHaveLength(2);
    expect(renders[1]?.components).toEqual([card, button]);
  });

  it("draws the file being edited in place of the saved one", () => {
    const { preview, renders } = fakePreview();
    setPreview(preview);
    const saved = specOf("Button");
    useComponents.setState({ components: [saved] });
    const edited = { ...saved, base: { root: { fill: "#f00" } } };
    show(<Matrix component={edited} meta={undefined} />);
    expect(renders.at(-1)?.components).toEqual([edited]);
  });
});
