// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SYSTEM_COMPONENTS, slotFor, systemComponentOf } from "./catalogue.ts";
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

  it("puts a child that names no slot in the default one, and a named one in its own", () => {
    const dialog = systemComponentOf("Dialog");
    expect(dialog && slotFor(dialog, undefined)?.name).toBe("dialog-content");
    expect(dialog && slotFor(dialog, "dialog-footer")?.name).toBe(
      "dialog-footer"
    );
    // A part that holds no nodes is no slot to fill.
    expect(dialog && slotFor(dialog, "dialog-title")).toBeUndefined();
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
    // A portal is not the component's root: the specs find its parts as a portal's.
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
