// @vitest-environment happy-dom
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { ComponentSpec } from "@ultrapaint/contracts/specs";
import type {
  FrameRuntime,
  Preview,
  RenderRequest,
} from "@ultrapaint/framework-api/browser";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDesignSystem } from "../state/design-system.ts";
import { useSpecs } from "../state/specs.ts";
import { Matrix } from "./design-components.tsx";
import { TypeSpecimen } from "./design-system.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

/** The preview `usePreview` answers: none until a test gives one, as the project's host runs. */
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
    notifyHmr: () => undefined,
    onRunning: () => () => undefined,
    onStrayError: () => () => undefined,
    reportError: () => undefined,
    setComponents: () => undefined,
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

const specOf = (component: string): ComponentSpec => ({
  base: {},
  component,
  defaults: {},
  from: "@/components/ui",
  look: "design",
  slots: [{ name: "root" }],
  states: {},
  variants: {},
  version: 1,
});

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
  useDesignSystem.setState({ designSystem: ds, previewCss: undefined });
  useSpecs.setState({ specs: [] });
});

afterEach(() => {
  const r = root;
  root = null;
  act(() => r?.unmount());
  setPreview(null);
});

describe("a specimen's drawing", () => {
  it("draws the type samples again when the preview comes back", () => {
    const first = fakePreview();
    setPreview(first.preview);
    show(<TypeSpecimen ds={ds} q="" />);
    expect(first.renders).toHaveLength(1);

    // The preview stops and starts again: the frame is thrown away and opened anew.
    setPreview(null);
    const second = fakePreview();
    setPreview(second.preview);
    expect(second.renders).toHaveLength(1);
    expect(second.renders[0]?.root).toEqual(first.renders[0]?.root);
  });

  it("draws the matrix again when the preview comes back", () => {
    const first = fakePreview();
    setPreview(first.preview);
    show(<Matrix meta={undefined} spec={specOf("Button")} />);
    expect(first.renders).toHaveLength(1);

    setPreview(null);
    const second = fakePreview();
    setPreview(second.preview);
    expect(second.renders).toHaveLength(1);
  });

  it("draws the matrix again when another component's spec changes, and not for nothing", () => {
    const { preview, renders } = fakePreview();
    setPreview(preview);
    const button = specOf("Button");
    show(<Matrix meta={undefined} spec={button} />);
    expect(renders).toHaveLength(1);
    expect(renders[0]?.specs).toEqual([button]);

    // Drawn again with the same spec: nothing changed, nothing is drawn.
    show(<Matrix meta={undefined} spec={button} />);
    expect(renders).toHaveLength(1);

    // A card drawn inside the button looks as its spec says.
    const card = specOf("Card");
    act(() => useSpecs.setState({ specs: [card] }));
    expect(renders).toHaveLength(2);
    expect(renders[1]?.specs).toEqual([card, button]);
  });

  it("draws the spec being edited in place of the saved one", () => {
    const { preview, renders } = fakePreview();
    setPreview(preview);
    const saved = specOf("Button");
    useSpecs.setState({ specs: [saved] });
    const edited = { ...saved, base: { root: { fill: "#f00" } } };
    show(<Matrix meta={undefined} spec={edited} />);
    expect(renders.at(-1)?.specs).toEqual([edited]);
  });
});
