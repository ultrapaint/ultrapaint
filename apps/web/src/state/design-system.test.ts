import "../testing/fake-browser.ts";
import { RequestError } from "@ultrapaint/client-runtime/connection";
import {
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import type { DesignSystemEdit } from "@ultrapaint/contracts/design-system-edit";
import { tokenOf } from "@ultrapaint/contracts/token-table";
import { applyEdits } from "@ultrapaint/design-document/design-system-edits";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { until } from "../testing/until.ts";
import { commitEdits, draftEdits, useDesignSystem } from "./design-system.ts";
import { useProject } from "./project.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const INK = "color-ink";
const RADIUS = "radius-md";

const first: DesignSystem = {
  ...emptyDesignSystem(),
  colors: [{ name: "Semantic", tokens: [{ name: INK, value: "#111111" }] }],
  radius: [{ name: RADIUS, value: "0.5rem" }],
};

const ink = (value: string): DesignSystemEdit[] => [
  { name: INK, op: "setValue", value },
];
const radius = (value: string): DesignSystemEdit[] => [
  { name: RADIUS, op: "setValue", value },
];

/** The server's design system, and the edits it was sent and has not answered yet. */
let server: DesignSystem = first;
let waiting: {
  ops: readonly DesignSystemEdit[];
  refuse: (error: Error) => void;
  save: () => void;
}[] = [];

/** What the editor draws of a token: the draft over what the server last sent. */
const drawn = (name: string) =>
  tokenOf(useDesignSystem.getState().designSystem, name)?.value;

/** The editor holds the server's design system as it is now. */
const settled = () => until(useDesignSystem, (s) => s.saved === server);

beforeEach(async () => {
  fakeApi.reset();
  server = first;
  waiting = [];
  fakeApi.respond("designSystem.get", () => ({
    designSystem: server,
    document: null,
  }));
  // An edit is answered when the test says: saved, the server's design system has it.
  fakeApi.respond(
    "designSystem.edit",
    ({ ops }) =>
      new Promise((resolve, reject) => {
        waiting.push({
          ops,
          refuse: reject,
          save: () => {
            const edited = applyEdits(server, ops);
            if ("problem" in edited) {
              throw new Error(edited.problem);
            }
            server = edited;
            resolve({ files: [] });
          },
        });
      })
  );
  useProject.setState({ error: null });
  draftEdits(null);
  await useDesignSystem.getState().load();
});

describe("a field typed in while another's commit is on its way", () => {
  it("stays drawn once the commit is saved", async () => {
    const committed = commitEdits(ink("#222222"));
    draftEdits(radius("1rem"));
    waiting[0]?.save();
    expect(await committed).toBe(true);
    await settled();
    expect(drawn(INK)).toBe("#222222");
    expect(drawn(RADIUS)).toBe("1rem");
  });

  it("stays drawn when the commit is refused", async () => {
    const committed = commitEdits(ink("#222222"));
    draftEdits(radius("1rem"));
    waiting[0]?.refuse(new RequestError("bad_request", "no such token"));
    expect(await committed).toBe(false);
    expect(drawn(INK)).toBe("#111111");
    expect(drawn(RADIUS)).toBe("1rem");
  });

  it("gives way to what the server sends back when it is committed too", async () => {
    const one = commitEdits(ink("#222222"));
    const two = commitEdits(radius("1rem"));
    waiting[0]?.save();
    await one;
    await settled();
    // The second is still on its way: drawn as its draft.
    expect(drawn(RADIUS)).toBe("1rem");
    waiting[1]?.save();
    await two;
    await settled();
    expect(useDesignSystem.getState().designSystem).toBe(server);
    expect(drawn(INK)).toBe("#222222");
    expect(drawn(RADIUS)).toBe("1rem");
  });
});

describe("a commit", () => {
  it("is drawn while it is on its way, and gives way to what the server sends back", async () => {
    const committed = commitEdits(ink("#222222"));
    expect(drawn(INK)).toBe("#222222");
    waiting[0]?.save();
    await committed;
    await settled();
    expect(useDesignSystem.getState().designSystem).toBe(server);
  });

  it("refused, is drawn no more", async () => {
    const committed = commitEdits(ink("#222222"));
    waiting[0]?.refuse(new RequestError("bad_request", "no such token"));
    expect(await committed).toBe(false);
    expect(drawn(INK)).toBe("#111111");
    expect(useProject.getState().error).toBe("no such token");
  });
});
