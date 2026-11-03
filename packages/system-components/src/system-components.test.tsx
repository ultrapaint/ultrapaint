// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SYSTEM_COMPONENTS } from "./catalogue.ts";
import { SYSTEM_COMPONENT_VIEWS } from "./components.tsx";
import { type ComponentFrame, ComponentFrameProvider } from "./frame.ts";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("the catalogue", () => {
  it("names a component for every system component, and a system component for every component", () => {
    expect(SYSTEM_COMPONENTS.map((p) => p.name).sort()).toEqual(
      Object.keys(SYSTEM_COMPONENT_VIEWS).sort()
    );
  });

  it("gives every system component one root and at most one default slot", () => {
    for (const meta of SYSTEM_COMPONENTS) {
      expect(
        meta.slots.filter((s) => s.holds === "default").length
      ).toBeLessThanOrEqual(1);
      expect(new Set(meta.slots.map((s) => s.name)).size).toBe(
        meta.slots.length
      );
    }
  });
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

/** A frame of the editor's page: a host with a shadow root, its body where popups go. */
const frame = () => {
  const host = document.createElement("div");
  host.setAttribute("data-ed-frame-host", "test");
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const body = document.createElement("div");
  const canvas = document.createElement("div");
  body.append(canvas);
  shadow.append(body);
  return { body, canvas, host, shadow };
};

const draw = (
  at: ReturnType<typeof frame>,
  interactive: boolean,
  element: React.ReactNode
) => {
  const value: ComponentFrame = {
    container: at.body,
    host: at.host,
    interactive,
  };
  root ??= createRoot(at.canvas);
  act(() =>
    root?.render(
      <ComponentFrameProvider frame={value}>{element}</ComponentFrameProvider>
    )
  );
};

const Dialog = SYSTEM_COMPONENT_VIEWS.Dialog as (
  props: Record<string, unknown>
) => React.ReactNode;

describe("an overlay", () => {
  it("is drawn open in its frame when the design says so, with the node's marks", () => {
    const at = frame();
    draw(
      at,
      false,
      <Dialog data-ed-c="Dialog" data-ed-node="d1" open title="Delete?" />
    );
    const popup = at.shadow.querySelector('[data-slot="dialog"]');
    expect(popup?.getAttribute("data-ed-node")).toBe("d1");
    // A portal is not the component's root: the looks find its parts as a portal's.
    expect(popup?.getAttribute("data-ed-p")).toBe("Dialog");
    expect(popup?.hasAttribute("data-ed-c")).toBe(false);
    expect(
      at.shadow.querySelector('[data-slot="dialog-title"]')?.textContent
    ).toBe("Delete?");
    // Nothing of it reaches the editor's document.
    expect(document.body.querySelector('[data-slot="dialog"]')).toBeNull();
  });

  it("is closed when the design says nothing", () => {
    const at = frame();
    draw(at, false, <Dialog data-ed-node="d1" title="Delete?" />);
    expect(at.shadow.querySelector('[data-slot="dialog"]')).toBeNull();
  });

  it("fills its slots: the footer's nodes in the footer, the children in the content", () => {
    const at = frame();
    draw(
      at,
      false,
      <Dialog
        open
        slots={{ "dialog-footer": <button type="button">Cancel</button> }}
        title="Delete?"
      >
        <p>Why?</p>
      </Dialog>
    );
    expect(
      at.shadow.querySelector('[data-slot="dialog-footer"]')?.textContent
    ).toBe("Cancel");
    expect(
      at.shadow.querySelector('[data-slot="dialog-content"]')?.textContent
    ).toBe("Why?");
  });

  it("starts from the design when the frame runs, and follows it while designed", () => {
    const at = frame();
    draw(at, false, <Dialog open title="Delete?" />);
    expect(at.shadow.querySelector('[data-slot="dialog"]')).not.toBeNull();
    draw(at, true, <Dialog open title="Delete?" />);
    expect(at.shadow.querySelector('[data-slot="dialog"]')).not.toBeNull();
    draw(at, false, <Dialog open={false} title="Delete?" />);
    expect(
      at.shadow.querySelector('[data-slot="dialog"][data-open]')
    ).toBeNull();
  });
});

const Input = SYSTEM_COMPONENT_VIEWS.Input as (
  props: Record<string, unknown>
) => React.ReactNode;

describe("an input", () => {
  it("draws its icon inside its box, before the input that keeps its part", () => {
    const at = frame();
    draw(
      at,
      false,
      <Input
        disabled
        placeholder="you@example.com"
        slots={{ "input-icon": <svg aria-label="Mail" /> }}
      />
    );
    const box = at.shadow.querySelector('[data-system="input-box"]');
    expect(
      [...(box?.children ?? [])].map((c) => c.getAttribute("data-slot"))
    ).toEqual(["input-icon", "input"]);
    const icon = box?.querySelector('[data-slot="input-icon"]');
    expect(icon?.querySelector('[aria-label="Mail"]')).not.toBeNull();
    // Dimmed with the field: its disabled state is a look's, on the part.
    expect(icon?.hasAttribute("data-disabled")).toBe(true);
  });

  it("is drawn as before without an icon: the input straight in its field", () => {
    const at = frame();
    draw(at, false, <Input label="Email" />);
    expect(at.shadow.querySelector('[data-system="input-box"]')).toBeNull();
    expect(
      at.shadow.querySelector('[data-system="field"] > [data-slot="input"]')
    ).not.toBeNull();
  });
});
