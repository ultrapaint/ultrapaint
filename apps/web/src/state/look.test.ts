import "../testing/fake-browser.ts";
import type {
  ComponentFile,
  SystemComponentFile,
} from "@ultrapaint/contracts/components";
import type { Look, Preview } from "@ultrapaint/preview-core/preview";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { useComponents } from "./components.ts";
import {
  commitStyle,
  draftStyle,
  followLook,
  type StyleDraft,
  useLookDraft,
} from "./look.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const BUTTON: SystemComponentFile = {
  base: { root: { radius: 4 } },
  name: "Button",
  origin: "system",
  states: {},
  variants: {},
  version: 1,
};

const OUTLINE_HOVER: StyleDraft = {
  component: "Button",
  place: { state: "hover", variant: { axis: "variant", member: "outline" } },
  slot: "root",
  style: { fill: "#ff0000" },
};

/** The look the preview was set last, and the Button in it. */
const lastLook = (setLook: ReturnType<typeof vi.fn>) =>
  setLook.mock.lastCall?.[0] as Look;
const buttonIn = (look: Look) =>
  look.components.find((c) => c.name === "Button") as SystemComponentFile;

const setComponents = (components: ComponentFile[]) =>
  useComponents.setState({ components });

beforeEach(() => {
  fakeApi.reset();
  useLookDraft.setState({ draft: null });
  setComponents([BUTTON]);
});

describe("a look edited live (ADR 0045, B9)", () => {
  it("draws the part's style being typed over the saved file, in every frame's look", () => {
    const setLook = vi.fn();
    const stop = followLook({ setLook } as unknown as Preview);
    draftStyle(OUTLINE_HOVER);
    const drawn = buttonIn(lastLook(setLook));
    expect(drawn.variantStates?.variant?.outline?.hover?.root).toEqual({
      fill: "#ff0000",
    });
    expect(drawn.base).toEqual(BUTTON.base);
    expect(lastLook(setLook).css).toContain("#ff0000");
    // Let go, the saved file is drawn again.
    draftStyle(null);
    expect(buttonIn(lastLook(setLook))).toEqual(BUTTON);
    stop();
  });

  it("commits as one setStyle, drawn until the server's components replace it", async () => {
    const setLook = vi.fn();
    const stop = followLook({ setLook } as unknown as Preview);
    const saved: SystemComponentFile = {
      ...BUTTON,
      variantStates: {
        variant: { outline: { hover: { root: { fill: "#ff0000" } } } },
      },
    };
    fakeApi.respond("components.change", () => ({
      component: saved,
      file: "components/Button.component.json",
    }));
    fakeApi.respond("components.list", () => ({
      components: [
        { component: saved, file: "components/Button.component.json" },
      ],
    }));
    const committed = commitStyle(OUTLINE_HOVER);
    // The field closing as it commits does not let the draft go.
    draftStyle(null);
    expect(useLookDraft.getState().draft).toEqual(OUTLINE_HOVER);
    expect(await committed).toBe(true);
    expect(fakeApi.calls.find((c) => c.method === "components.change")).toEqual(
      {
        input: {
          change: {
            op: "setStyle",
            place: OUTLINE_HOVER.place,
            slot: "root",
            style: { fill: "#ff0000" },
          },
          name: "Button",
        },
        method: "components.change",
      }
    );
    await vi.waitFor(() => expect(useLookDraft.getState().draft).toBeNull());
    expect(buttonIn(lastLook(setLook))).toEqual(saved);
    stop();
  });

  it("lets the draft go at once when the server refuses it", async () => {
    const committed = commitStyle(OUTLINE_HOVER);
    expect(await committed).toBe(false);
    expect(useLookDraft.getState().draft).toBeNull();
  });
});
