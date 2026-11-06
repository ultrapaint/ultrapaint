import "../testing/fake-browser.ts";
import type { Thread } from "@ultrapaint/contracts/threads";
import {
  LOOK_PRESETS,
  lookSystem,
} from "@ultrapaint/design-document/look-dials";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lookBoards } from "../boards/look-boards.ts";
import { useLookPage } from "../state/look-page.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { openLookPage, overviewOf, saveTheLook } from "./look-page.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);
vi.mock("../state/panels.ts", () => ({ showLeftPanel: vi.fn() }));
vi.mock("../state/board.ts", () => ({
  leaveBoard: vi.fn(),
  openBoard: vi.fn(),
  useBoard: { subscribe: vi.fn() },
}));
vi.mock("../state/design-system.ts", () => ({
  useDesignSystem: { getState: () => ({ load: async () => undefined }) },
}));

const thread: Thread = {
  agentId: "claude-code",
  createdAt: 0,
  id: "t1",
  status: "idle",
  title: "New chat",
  updatedAt: 0,
};

const inputOf = (method: string) =>
  fakeApi.calls.find((c) => c.method === method)?.input;

afterEach(() => fakeApi.reset());

describe("the look page", () => {
  it("draws its samples in the look while it is open, and the project's once it closes", async () => {
    const calm = LOOK_PRESETS[0]?.dials;
    openLookPage();
    expect(useLookPage.getState().trial).toEqual(calm && lookSystem(calm));
    fakeApi.respond("designSystem.write", () => ({ findings: [] }));
    await saveTheLook();
    expect(useLookPage.getState()).toMatchObject({ open: false, trial: null });
  });

  it("writes the look with its overview, then sends the prompt that waited for it", async () => {
    fakeApi.respond("designSystem.write", () => ({ findings: [] }));
    fakeApi.respond("threads.create", () => thread);
    fakeApi.respond("threads.prompt", () => undefined);
    openLookPage({ look: "pick", prompt: "A habit tracker" });
    await saveTheLook();
    const { dials } = useLookPage.getState();
    expect(inputOf("designSystem.write")).toEqual({
      designSystem: lookSystem(dials),
      document: overviewOf(dials),
    });
    expect(inputOf("threads.prompt")).toMatchObject({
      text: "A habit tracker",
    });
  });

  it("has its samples in light and dark", () => {
    const calm = LOOK_PRESETS[0]?.dials;
    if (!calm) {
      return;
    }
    expect(lookBoards(calm).boards.map((b) => b.theme)).toEqual([
      "light",
      "light",
      "dark",
    ]);
  });
});
