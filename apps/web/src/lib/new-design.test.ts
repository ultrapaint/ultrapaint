import "../testing/fake-browser.ts";
import {
  type DesignSystemSetup,
  emptySetup,
} from "@ultrapaint/contracts/design-system-setup";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { openNewDesignOnSync } from "./new-design.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const location = window.location as { href?: string; search: string };
const replaced: string[] = [];
window.history.replaceState = (_state, _title, url) => {
  replaced.push(String(url));
};

const openedWith = (search: string) => {
  location.search = search;
  location.href = `http://127.0.0.1:4770/${search}`;
};

/** The setup with the inventory where a request leaves it. */
const withInventory = (
  status: "todo" | "review" | "done"
): DesignSystemSetup => {
  const setup = emptySetup(0);
  return {
    ...setup,
    steps: setup.steps.map((s) =>
      s.id === "inventory" ? { ...s, status } : s
    ),
  };
};

const answerSetup = () => {
  fakeApi.respond("dsSetup.get", () => withInventory("todo"));
  fakeApi.respond("dsSetup.start", () => ({ setup: withInventory("review") }));
  fakeApi.respond("dsSetup.complete", () => withInventory("done"));
  fakeApi.respond("catalogue.get", () => ({
    components: [
      { importFrom: "@/components/ui/button", name: "Button", styles: {} },
      { importFrom: "@/components/ui/card", name: "Card" },
    ],
  }));
  fakeApi.respond("specs.list", () => ({ specs: [] }));
};

const methods = () => fakeApi.calls.map((c) => c.method);

afterEach(() => {
  fakeApi.reset();
  replaced.length = 0;
  openedWith("");
});

describe("a design the desktop app has just written", () => {
  it("opens on Sync's define step: the inventory of its template is read and gone past", async () => {
    openedWith("?new-design=blank");
    answerSetup();
    await openNewDesignOnSync();
    expect(methods()).toContain("dsSetup.start");
    expect(
      fakeApi.calls.find((c) => c.method === "dsSetup.start")?.input
    ).toEqual({ step: "inventory" });
    expect(methods()).toContain("dsSetup.complete");
    expect(methods()).toContain("sync.plan");
    // A blank design has no components to give specs.
    expect(methods()).not.toContain("specs.fromCode");
    // Taken off the address: a reload is not a new design.
    expect(replaced).toEqual(["/"]);
  });

  it("gives the starter's components their specs, the look the design's", async () => {
    openedWith("?new-design=starter");
    answerSetup();
    await openNewDesignOnSync();
    expect(
      fakeApi.calls
        .filter((c) => c.method === "specs.fromCode")
        .map((c) => c.input)
    ).toEqual([
      { component: "Button", from: "@/components/ui/button", look: "design" },
    ]);
  });

  it("leaves any other opening of the editor as it is", async () => {
    openedWith("?page=home.page.json");
    await openNewDesignOnSync();
    expect(fakeApi.calls).toEqual([]);
    expect(replaced).toEqual([]);
  });
});
