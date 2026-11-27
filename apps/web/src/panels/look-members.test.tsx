// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { SystemComponentFile } from "@ultrapaint/contracts/components";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComponents } from "../state/components.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { LookInspector } from "./look-inspector.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** The project's Badge, its look taken over. */
const BADGE: SystemComponentFile = {
  base: {},
  name: "Badge",
  origin: "system",
  states: {},
  variants: {},
  version: 1,
};

let mounted: Root;
let container: HTMLElement;

beforeEach(() => {
  fakeApi.reset();
  useComponents.setState({ components: [BADGE] });
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
  act(() => mounted.render(<LookInspector meta={undefined} name="Badge" />));
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
});

const field = (label: string) => {
  const found = container.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`
  );
  if (!found) {
    throw new Error(`no field ${label}`);
  }
  return found;
};

/** Types into a field as a person does, then leaves it. */
const typeAndLeave = (label: string, value: string) =>
  act(() => {
    const input = field(label);
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.blur();
  });

/** The changes sent to the server, in their order. */
const sent = () =>
  fakeApi.calls
    .filter((c) => c.method === "components.change")
    .map((c) => (c.input as { change: unknown }).change);

describe("a system component's own variant members, in its look (ADR 0161)", () => {
  it("lists each axis's members, and adds and takes out those typed, the added first", async () => {
    fakeApi.respond("components.change", () => undefined as never);
    expect(field("variant’s members").value).toBe(
      "default, secondary, outline, destructive, warning, success, info"
    );
    typeAndLeave(
      "variant’s members",
      "default, secondary, destructive, warning, success, info, neutral-strong"
    );
    // The second is sent once the first is answered.
    await act(() => fakeApi.requested("components.change", 2));
    expect(sent()).toEqual([
      { axis: "variant", member: "neutral-strong", op: "addMember" },
      { axis: "variant", member: "outline", op: "removeMember" },
    ]);
  });

  it("adds an axis of the product's own with its members, the first its default", async () => {
    fakeApi.respond("components.change", () => undefined as never);
    typeAndLeave("New axis", "shape: default, pill");
    await act(() => fakeApi.requested("components.change", 2));
    expect(sent()).toEqual([
      { axis: "shape", member: "default", op: "addMember" },
      { axis: "shape", member: "pill", op: "addMember" },
    ]);
    expect(field("New axis").value).toBe("");
  });

  it("shows the members the look adds, and none it takes out", () => {
    act(() =>
      useComponents.setState({
        components: [
          {
            ...BADGE,
            members: {
              shape: { add: ["default", "pill"] },
              variant: { remove: ["outline"] },
            },
          },
        ],
      })
    );
    expect(field("variant’s members").value).toBe(
      "default, secondary, destructive, warning, success, info"
    );
    expect(field("shape’s members").value).toBe("default, pill");
  });
});
