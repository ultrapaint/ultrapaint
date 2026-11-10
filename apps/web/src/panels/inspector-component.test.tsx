// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { RequestError } from "@ultrapaint/client-runtime/connection";
import type {
  AppComponentFile,
  ComponentProperty,
} from "@ultrapaint/contracts/components";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { until } from "../testing/until.ts";
import { PropertyRow } from "./inspector-component.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const label: ComponentProperty = { default: "", kind: "text", name: "label" };

/** Promo, with a title and a label: the label cannot be renamed to title. */
const promo = {
  name: "Promo",
  origin: "app",
  properties: [{ default: "", kind: "text", name: "title" }, label],
  slots: [],
  tree: { children: [], id: "p-root", type: "column" },
  version: 1,
} as unknown as AppComponentFile;

let mounted: Root;
let container: HTMLElement;

const nameField = () =>
  container.querySelector<HTMLInputElement>(
    'input[aria-label="Property name"]'
  ) as HTMLInputElement;

/** Types into the name as React hears it, the field focused as it is when typed in. */
const typeName = (value: string) =>
  act(() => {
    nameField().focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(nameField(), value);
    nameField().dispatchEvent(new Event("input", { bubbles: true }));
  });

const renames = () =>
  fakeApi.calls.filter((c) => c.method === "components.change");

beforeEach(() => {
  fakeApi.reset();
  useProject.setState({ error: null });
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
  act(() => mounted.render(<PropertyRow file={promo} property={label} />));
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
  useProject.setState({ error: null });
});

describe("a property's name", () => {
  it("goes back to the property's when the server refuses the one typed", async () => {
    fakeApi.respond("components.change", () =>
      Promise.reject(
        new RequestError("bad_request", "Promo has a title already")
      )
    );
    typeName("title");
    act(() => nameField().blur());
    await act(() => until(useProject, (s) => s.error !== null));
    expect(useProject.getState().error).toBe("Promo has a title already");
    expect(nameField().value).toBe("label");
    // Left again, there is nothing to send.
    act(() => {
      nameField().focus();
      nameField().blur();
    });
    expect(renames()).toHaveLength(1);
  });

  it("is committed once by Enter, which leaves the field", async () => {
    fakeApi.respond("components.change", () => undefined as never);
    typeName("caption");
    act(() => {
      nameField().dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
      );
    });
    await act(() => fakeApi.requested("components.change"));
    expect(document.activeElement).not.toBe(nameField());
    expect(renames().map((c) => c.input)).toEqual([
      {
        change: { name: "label", op: "renameProperty", to: "caption" },
        name: "Promo",
      },
    ]);
  });
});
