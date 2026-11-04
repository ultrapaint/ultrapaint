// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { ProfileRow } from "./settings-profile.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root;
let container: HTMLElement;

const field = () =>
  container.querySelector<HTMLInputElement>("#settings-display-name");

/** Types into the field as React hears it, then leaves it. */
const typeAndLeave = async (value: string) => {
  const input = field();
  if (!input) {
    throw new Error("no field");
  }
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  await act(async () => {
    await fakeApi.requested("profile.set");
  });
};

const render = async () => {
  container = document.createElement("div");
  mounted = createRoot(container);
  act(() => {
    mounted.render(<ProfileRow />);
  });
  // The answer lands, and the row draws what it says.
  await act(async () => {
    await fakeApi.requested("profile.get");
  });
};

beforeEach(() => {
  fakeApi.reset();
  useProject.setState({
    info: {
      configured: true,
      gitUser: { email: "ada@example.com", name: "Ada Lovelace" },
      storage: { mode: "managed" },
    },
  });
});

afterEach(() => {
  act(() => mounted.unmount());
});

describe("the display name", () => {
  it("is empty when none is set, and says once that git's name stands in", async () => {
    fakeApi.respond("profile.get", () => ({}));
    await render();
    expect(field()?.value).toBe("");
    expect(field()?.placeholder).toBe("");
    expect(container.textContent).toContain(
      "Left empty, they’re signed Ada Lovelace, from git."
    );
  });

  it("says under the field that it was saved", async () => {
    fakeApi.respond("profile.get", () => ({}));
    fakeApi.respond("profile.set", (input) => input);
    await render();
    await typeAndLeave("Ada");
    expect(fakeApi.calls.filter((c) => c.method === "profile.set")).toEqual([
      { input: { displayName: "Ada" }, method: "profile.set" },
    ]);
    expect(container.textContent).toContain("Saved");
  });

  it("stays usable when it could not be read, and says why under the row", async () => {
    fakeApi.respond("profile.get", () => Promise.reject(new Error("offline")));
    await render();
    expect(field()?.disabled).toBe(false);
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Couldn’t read your name"
    );
  });

  it("says under the row why it could not be saved", async () => {
    fakeApi.respond("profile.get", () => ({}));
    fakeApi.respond("profile.set", () =>
      Promise.reject(new Error("disk full"))
    );
    await render();
    await typeAndLeave("Ada");
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Couldn’t save your name (disk full)"
    );
  });
});
