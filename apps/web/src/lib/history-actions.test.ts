import "../testing/fake-browser.ts";
import type { HistoryPoint } from "@ultrapaint/contracts/snapshots";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmDialog } from "../components/dialogs.tsx";
import { useHistory } from "../state/history.ts";
import { followServer } from "../state/server-data.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { restorePoint, saveVersion } from "./history-actions.ts";

const toasts = vi.hoisted(
  () =>
    [] as {
      action?: { onClick: () => unknown };
      description?: string;
      message: string;
    }[]
);
vi.mock("sonner", () => ({
  toast: {
    success: (
      message: string,
      options?: { action?: { onClick: () => unknown }; description?: string }
    ) => toasts.push({ message, ...options }),
  },
}));

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

vi.mock("../components/dialogs.tsx", async (original) => ({
  ...(await original<typeof import("../components/dialogs.tsx")>()),
  confirmDialog: vi.fn(() => Promise.resolve(true)),
  promptDialog: () => Promise.resolve("Shown to the client"),
}));

const KEPT_RE = /^Your 2 edits since .+ are kept in History\.$/;

const edits: HistoryPoint = {
  at: 2,
  canvases: [""],
  edits: 3,
  files: ["designs/home.page.json"],
  id: "hp_2",
  kind: "edits",
};
const version: HistoryPoint = { ...edits, name: "Shown to the client" };

let stop: () => void = () => undefined;
const reported: unknown[] = [];

beforeEach(() => {
  fakeApi.reset();
  useHistory.setState({ failed: false, pending: null, points: null });
  fakeApi.respond("project.info", () => ({
    configured: false,
    host: { state: "stopped" },
    storage: { mode: "managed" },
  }));
  fakeApi.respond("history.get", () => ({ pending: null, points: [] }));
  reported.length = 0;
  toasts.length = 0;
  vi.mocked(confirmDialog).mockClear();
  stop = followServer({ report: (error) => reported.push(error) });
});

afterEach(() => stop());

describe("saving a version", () => {
  it("shows in the history by the server's news of it, nothing read again", async () => {
    await useHistory.getState().load();
    fakeApi.calls.length = 0;
    // The server publishes the points as it names one, before it answers.
    fakeApi.respond("history.save", () => {
      fakeApi.emit("history", [version]);
      return version;
    });

    await saveVersion();
    expect(useHistory.getState().points).toEqual([version]);
    expect(fakeApi.calls.map((c) => c.method)).toEqual(["history.save"]);
    expect(toasts.map((t) => t.message)).toEqual(["Saved Shown to the client"]);
    expect(reported).toEqual([]);
  });
});

describe("restoring a point", () => {
  it("restores at once, as one step the toast's Undo takes back", async () => {
    fakeApi.respond("history.restore", () => undefined);
    fakeApi.respond("edit.undo", () => null);

    await restorePoint(version);
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(fakeApi.calls.map((c) => c.method)).toContain("history.restore");
    expect(toasts.map((t) => t.message)).toEqual([
      "Restored to “Shown to the client”",
    ]);

    fakeApi.calls.length = 0;
    // The toast's Undo is the editor's undo, files and canvas alike.
    await toasts[0]?.action?.onClick();
    expect(fakeApi.calls.map((c) => c.method)).toContain("edit.undo");
    expect(reported).toEqual([]);
  });

  it("says the edits not in a point yet were kept first", async () => {
    fakeApi.respond("history.restore", () => undefined);
    useHistory.setState({ pending: { edits: 2, since: 0 } });
    await restorePoint(edits);
    expect(toasts[0]?.message).toBe("Restored to “Your edits”");
    expect(toasts[0]?.description).toMatch(KEPT_RE);
  });
});
