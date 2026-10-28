import "../testing/fake-browser.ts";
import type { Snapshot } from "@ultrapaint/contracts/snapshots";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKept } from "../state/kept.ts";
import { followServer } from "../state/server-data.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { deleteSnapshot, saveSnapshot } from "./snapshot-actions.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

vi.mock("../components/dialogs.tsx", async (original) => ({
  ...(await original<typeof import("../components/dialogs.tsx")>()),
  confirmDialog: () => Promise.resolve(true),
  promptDialog: () => Promise.resolve("Shown to the client"),
}));

const made: Snapshot = {
  at: 2,
  files: 3,
  id: "sn_2",
  name: "Shown to the client",
};

let stop: () => void = () => undefined;
const reported: unknown[] = [];

beforeEach(() => {
  fakeApi.reset();
  useKept.setState({ checkpoints: null, snapshots: null });
  fakeApi.respond("project.info", () => ({
    configured: false,
    host: { state: "stopped" },
    storage: { mode: "managed" },
  }));
  fakeApi.respond("checkpoints.list", () => []);
  fakeApi.respond("snapshots.list", () => []);
  reported.length = 0;
  stop = followServer({ report: (error) => reported.push(error) });
});

afterEach(() => stop());

describe("saving and deleting a snapshot", () => {
  it("shows in the history by the server's news of it, nothing read again", async () => {
    await useKept.getState().load();
    fakeApi.calls.length = 0;
    // The server publishes the list as it keeps the snapshot, before it answers.
    fakeApi.respond("snapshots.create", () => {
      fakeApi.emit("snapshots", [made]);
      return made;
    });
    fakeApi.respond("snapshots.delete", () => {
      fakeApi.emit("snapshots", []);
    });

    await saveSnapshot();
    expect(useKept.getState().snapshots).toEqual([made]);
    await deleteSnapshot(made);
    expect(useKept.getState().snapshots).toEqual([]);
    expect(fakeApi.calls.map((c) => c.method)).toEqual([
      "snapshots.create",
      "snapshots.delete",
    ]);
    expect(reported).toEqual([]);
  });
});
