// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import {
  KeepFindingsRow,
  ProfileRow,
  SandboxRow,
  sandboxUnavailable,
} from "./settings-profile.tsx";

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

/** Types into the field as React hears it. */
const type = (value: string) => {
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
};

/** Types into the field, then leaves it. */
const typeAndLeave = async (value: string) => {
  type(value);
  act(() => {
    field()?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
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
  vi.useRealTimers();
});

describe("the display name", () => {
  it("is empty when none is set, showing git's name as its placeholder and saying where it is from", async () => {
    fakeApi.respond("profile.get", () => ({}));
    await render();
    expect(field()?.value).toBe("");
    expect(field()?.placeholder).toBe("Ada Lovelace");
    expect(container.textContent).toContain(
      "Left empty, your name from git is used."
    );
  });

  it("saves the name when the field is left", async () => {
    fakeApi.respond("profile.get", () => ({}));
    fakeApi.respond("profile.set", (input) => input);
    await render();
    await typeAndLeave("Ada");
    expect(fakeApi.calls.filter((c) => c.method === "profile.set")).toEqual([
      { input: { displayName: "Ada" }, method: "profile.set" },
    ]);
    expect(container.textContent).not.toContain("Saved");
  });

  it("saves the name after a pause in typing", async () => {
    // fake clock: the pause the row waits for before it saves
    vi.useFakeTimers();
    fakeApi.respond("profile.get", () => ({}));
    fakeApi.respond("profile.set", (input) => input);
    await render();
    type("Ada");
    expect(fakeApi.calls.some((c) => c.method === "profile.set")).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(fakeApi.calls.filter((c) => c.method === "profile.set")).toEqual([
      { input: { displayName: "Ada" }, method: "profile.set" },
    ]);
    expect(container.textContent).toContain(
      "Signs your comments and draws your avatar."
    );
  });

  it("never writes a save's answer into what is typed after it", async () => {
    // fake clock: the pause the row waits for before it saves
    vi.useFakeTimers();
    let answer: (profile: { displayName: string }) => void = () => undefined;
    fakeApi.respond("profile.get", () => ({}));
    fakeApi.respond("profile.set", (input) =>
      new Promise((resolve) => {
        answer = resolve;
      }).then(() => input)
    );
    await render();
    await typeAndLeave("Ada");
    type("Ada Lovelace");
    await act(async () => {
      answer({ displayName: "Ada" });
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(field()?.value).toBe("Ada Lovelace");
    await act(async () => {
      await fakeApi.requested("profile.set", 2);
    });
    expect(
      fakeApi.calls
        .filter((c) => c.method === "profile.set")
        .map((c) => c.input)
    ).toEqual([{ displayName: "Ada" }, { displayName: "Ada Lovelace" }]);
  });

  it("offers Try again when it could not be read", async () => {
    let reads = 0;
    fakeApi.respond("profile.get", () => {
      reads += 1;
      return reads === 1
        ? Promise.reject(new Error("offline"))
        : { displayName: "Ada" };
    });
    await render();
    const again = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Try again"
    );
    act(() => again?.click());
    await act(async () => {
      await fakeApi.requested("profile.get", 2);
    });
    expect(field()?.value).toBe("Ada");
    expect(container.querySelector("[role=alert]")).toBeNull();
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

describe("Keep findings", () => {
  it("shows whether the person keeps findings, and saves a change to their profile at once", async () => {
    fakeApi.respond("profile.get", () => ({ keepFindings: true }));
    fakeApi.respond("profile.set", (input) => ({ ...input }));
    container = document.createElement("div");
    mounted = createRoot(container);
    act(() => {
      mounted.render(<KeepFindingsRow />);
    });
    await act(async () => {
      await fakeApi.requested("profile.get");
    });
    const toggle = container.querySelector<HTMLElement>('[role="switch"]');
    expect(toggle?.hasAttribute("data-checked")).toBe(true);
    act(() => toggle?.click());
    await act(async () => {
      await fakeApi.requested("profile.set");
    });
    expect(fakeApi.calls.filter((c) => c.method === "profile.set")).toEqual([
      { input: { keepFindings: false }, method: "profile.set" },
    ]);
  });
});

describe("Run agents in a sandbox", () => {
  it("is on while the profile says nothing, and saves turning it off (ADR 0119)", async () => {
    fakeApi.respond("profile.get", () => ({}));
    fakeApi.respond("profile.set", (input) => ({ ...input }));
    fakeApi.respond("agents.sandbox", () => ({
      available: true,
      platform: "linux",
    }));
    container = document.createElement("div");
    mounted = createRoot(container);
    act(() => {
      mounted.render(<SandboxRow />);
    });
    await act(async () => {
      await fakeApi.requested("profile.get");
    });
    const toggle = container.querySelector<HTMLElement>('[role="switch"]');
    expect(toggle?.hasAttribute("data-checked")).toBe(true);
    act(() => toggle?.click());
    await act(async () => {
      await fakeApi.requested("profile.set");
    });
    expect(fakeApi.calls.filter((c) => c.method === "profile.set")).toEqual([
      { input: { sandbox: false }, method: "profile.set" },
    ]);
    expect(toggle?.hasAttribute("data-checked")).toBe(false);
  });

  it("waits for a save before taking another, and goes back to the saved value when it fails", async () => {
    fakeApi.respond("profile.get", () => ({}));
    fakeApi.respond("agents.sandbox", () => ({
      available: true,
      platform: "linux",
    }));
    let fail: (error: Error) => void = () => undefined;
    fakeApi.respond(
      "profile.set",
      () =>
        new Promise<never>((_, reject) => {
          fail = reject;
        })
    );
    container = document.createElement("div");
    mounted = createRoot(container);
    act(() => {
      mounted.render(<SandboxRow />);
    });
    await act(async () => {
      await fakeApi.requested("profile.get");
    });
    const toggle = container.querySelector<HTMLElement>('[role="switch"]');
    act(() => toggle?.click());
    await act(async () => {
      await fakeApi.requested("profile.set");
    });
    expect(toggle?.hasAttribute("data-disabled")).toBe(true);
    act(() => toggle?.click());
    expect(
      fakeApi.calls.filter((c) => c.method === "profile.set")
    ).toHaveLength(1);
    await act(async () => {
      fail(new Error("disk full"));
      await Promise.resolve();
    });
    expect(toggle?.hasAttribute("data-checked")).toBe(true);
    expect(toggle?.hasAttribute("data-disabled")).toBe(false);
    expect(container.textContent).toContain("Couldn’t save it (disk full)");
  });

  it("shows off and says why on a computer that can't confine agents, keeping the choice", async () => {
    fakeApi.respond("profile.get", () => ({}));
    fakeApi.respond("agents.sandbox", () => ({
      available: false,
      platform: "linux",
    }));
    container = document.createElement("div");
    mounted = createRoot(container);
    act(() => {
      mounted.render(<SandboxRow />);
    });
    await act(async () => {
      await fakeApi.requested("agents.sandbox");
      await fakeApi.requested("profile.get");
    });
    const toggle = container.querySelector<HTMLElement>('[role="switch"]');
    expect(toggle?.hasAttribute("data-checked")).toBe(false);
    expect(toggle?.hasAttribute("data-disabled")).toBe(true);
    expect(container.textContent).toContain("Install bubblewrap");
    expect(fakeApi.calls.some((c) => c.method === "profile.set")).toBe(false);
  });

  it("keeps saying why when the profile can't be read either", async () => {
    fakeApi.respond("profile.get", () =>
      Promise.reject(new Error("unreadable"))
    );
    fakeApi.respond("agents.sandbox", () => ({
      available: false,
      platform: "linux",
    }));
    container = document.createElement("div");
    mounted = createRoot(container);
    act(() => {
      mounted.render(<SandboxRow />);
    });
    await act(async () => {
      await fakeApi.requested("agents.sandbox");
      await fakeApi.requested("profile.get");
    });
    expect(container.textContent).toContain("Couldn’t read the setting");
    expect(container.textContent).toContain("Install bubblewrap");
  });

  it("says what stopped the sandbox, or that the system has none", () => {
    expect(
      sandboxUnavailable({
        available: false,
        platform: "linux",
        problem:
          "bwrap refused to start: setting up uid map: Permission denied",
      })
    ).toContain("setting up uid map: Permission denied. Once it can start");
    expect(
      sandboxUnavailable({ available: false, platform: "win32" })
    ).toContain("macOS and Linux only");
    expect(sandboxUnavailable({ available: true, platform: "darwin" })).toBe(
      null
    );
  });
});
