import "../testing/fake-browser.ts";
import type { Checkpoint, Snapshot } from "@ultrapaint/contracts/snapshots";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { useKept } from "./kept.ts";
import { useProject } from "./project.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const snapshot: Snapshot = { at: 2, files: 3, id: "sn_1", name: "Shown" };
const checkpoint: Checkpoint = {
  at: 1,
  files: ["pages/home.json"],
  id: "cp_1",
  label: "Before the header pass",
  threadId: "t_1",
};

const lists = () => {
  const { checkpoints, checkpointsFailed, snapshots, snapshotsFailed } =
    useKept.getState();
  return { checkpoints, checkpointsFailed, snapshots, snapshotsFailed };
};

beforeEach(() => {
  fakeApi.reset();
  useKept.setState({
    checkpoints: null,
    checkpointsFailed: false,
    snapshots: null,
    snapshotsFailed: false,
  });
  useProject.setState({ error: null });
});

describe("the history's two lists", () => {
  it("each say their own read failed, the other read all the same", async () => {
    fakeApi.respond("snapshots.list", () => [snapshot]);
    fakeApi.respond("checkpoints.list", () =>
      Promise.reject(new Error("no checkpoints"))
    );
    await useKept.getState().load();
    expect(lists()).toEqual({
      checkpoints: null,
      checkpointsFailed: true,
      snapshots: [snapshot],
      snapshotsFailed: false,
    });
    expect(useProject.getState().error).toBe("no checkpoints");
  });

  it("stop saying so once read again", async () => {
    fakeApi.respond("snapshots.list", () =>
      Promise.reject(new Error("no snapshots"))
    );
    fakeApi.respond("checkpoints.list", () => [checkpoint]);
    await useKept.getState().load();
    expect(lists()).toMatchObject({
      checkpoints: [checkpoint],
      snapshots: null,
      snapshotsFailed: true,
    });

    fakeApi.respond("snapshots.list", () => [snapshot]);
    await useKept.getState().load();
    expect(lists()).toEqual({
      checkpoints: [checkpoint],
      checkpointsFailed: false,
      snapshots: [snapshot],
      snapshotsFailed: false,
    });
  });
});
