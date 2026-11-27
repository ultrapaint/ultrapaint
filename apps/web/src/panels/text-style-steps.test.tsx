// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import {
  type DesignSystem,
  emptyDesignSystem,
  type TextStyle,
} from "@ultrapaint/contracts/design-system";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDesignSystem } from "../state/design-system.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { TextStyleInspector } from "./token-inspector.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const heading: TextStyle = {
  at: { sm: { lineHeight: 1.2, size: 28 } },
  lineHeight: 1.25,
  name: "Display",
  role: "heading",
  size: 24,
};

const ds: DesignSystem = {
  ...emptyDesignSystem(),
  typography: {
    ...emptyDesignSystem().typography,
    sizes: [{ name: "text-3xl", value: "1.875rem" }],
    styles: [heading],
  },
};

let mounted: Root;
let container: HTMLElement;

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("designSystem.edit", () => ({ files: [] }));
  useDesignSystem.setState({ designSystem: ds, saved: ds });
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
  act(() => mounted.render(<TextStyleInspector ds={ds} name="Display" />));
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
  useDesignSystem.setState({ designSystem: null, saved: null });
});

/** The style each edit of the design system set, one edit to a call. */
const stylesSet = () =>
  fakeApi.calls
    .filter((c) => c.method === "designSystem.edit")
    .map((c) => (c.input as { ops: unknown[] }).ops);

/** A field's input, by the name its group is given. */
const field = (title: string) =>
  container.querySelector<HTMLInputElement>(`[aria-label="${title}"] input`);

const button = (tooltip: string) =>
  [...container.querySelectorAll<HTMLElement>("button")].find(
    (b) => b.getAttribute("aria-label") === tooltip
  );

describe("a text style's steps in its inspector (ADR 0160)", () => {
  it("shows each step's size and line height by its breakpoint", () => {
    expect(field("Size from sm")?.value).toBe("28");
    expect(field("Line height from sm")?.value).toBe("1.2");
  });

  it("changes a step's size in one edit of the design system", async () => {
    const size = field("Size from sm") as HTMLInputElement;
    act(() => {
      size.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 })
      );
    });
    const option = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((o) => o.textContent?.startsWith("3xl"));
    act(() => option?.click());
    await act(() => fakeApi.requested("designSystem.edit"));
    expect(stylesSet()).toEqual([
      [
        {
          op: "setTextStyle",
          style: {
            ...heading,
            at: { sm: { lineHeight: 1.2, size: "$text-3xl" } },
          },
        },
      ],
    ]);
  });

  it("removes a step in one edit, the style left without steps", async () => {
    act(() => button("Remove the sm step")?.click());
    await act(() => fakeApi.requested("designSystem.edit"));
    const { at: _at, ...plain } = heading;
    expect(stylesSet()).toEqual([[{ op: "setTextStyle", style: plain }]]);
  });

  it("adds a step at a breakpoint, as the style draws there", async () => {
    const trigger = container.querySelector<HTMLElement>(
      '[aria-label="Add a breakpoint"]'
    );
    act(() => trigger?.click());
    // Lets the select's opening settle.
    await act(async () => {
      await Promise.resolve();
    });
    const md = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((o) => o.textContent?.startsWith("md"));
    act(() => md?.click());
    await act(() => fakeApi.requested("designSystem.edit"));
    expect(stylesSet()).toEqual([
      [
        {
          op: "setTextStyle",
          style: {
            ...heading,
            at: {
              md: { lineHeight: 1.2, size: 28 },
              sm: { lineHeight: 1.2, size: 28 },
            },
          },
        },
      ],
    ]);
  });
});
