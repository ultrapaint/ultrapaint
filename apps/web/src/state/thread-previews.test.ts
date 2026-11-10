import "../testing/fake-browser.ts";
import type { DocumentState } from "@ultrapaint/contracts/document";
import type { Thread } from "@ultrapaint/contracts/threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { useDocuments } from "./documents.ts";
import { useProject } from "./project.ts";
import { refreshPreviews, useThreadPreviews } from "./thread-previews.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

/** What the preview answers each drawing with, in order: a picture, none (it timed out), or a throw. */
const shots = vi.hoisted(() => ({
  asked: 0,
  next: [] as (string | null | Error)[],
}));

vi.mock("../canvas/specimens.ts", () => ({
  drawSpecimen: () => {
    shots.asked += 1;
    const shot = shots.next.shift() ?? null;
    return shot instanceof Error ? Promise.reject(shot) : Promise.resolve(shot);
  },
}));

const HOME = "home.page.json";
const FILE = `designs/${HOME}`;
const PICTURE = "data:image/png;base64,AAAA";

const home: DocumentState = {
  doc: HOME,
  hash: `${HOME}@0`,
  root: { children: [], id: "home", type: "page" } as DocumentState["root"],
};

/** A thread started on the home page. The pictures are kept by thread: each test has its own. */
const threadOn = (id: string): Thread => ({
  agentId: "claude",
  createdAt: 1,
  id,
  scope: { file: FILE, name: "Home" },
  status: "idle",
  title: id,
  updatedAt: 1,
});

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("thumbnails.get", () => ({}));
  fakeApi.respond("thumbnails.put", () => undefined);
  shots.asked = 0;
  shots.next = [];
  // A picture that does not load is kept as it was drawn: no canvas to scale it on here.
  vi.stubGlobal(
    "Image",
    class {
      onerror: (() => void) | null = null;
      set src(_url: string) {
        this.onerror?.();
      }
    }
  );
  useProject.setState({
    pages: [{ canvas: "main", file: FILE, id: HOME, name: "Home", path: HOME }],
  });
  useDocuments.setState({ canvas: "main", docs: { [HOME]: home } });
  useThreadPreviews.setState({ pictures: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("refreshPreviews", () => {
  it("draws a thread's picture once while its document stays the same", async () => {
    shots.next = [PICTURE];
    const thread = threadOn("drawn");
    await refreshPreviews([thread]);
    await refreshPreviews([thread]);
    expect(useThreadPreviews.getState().pictures).toEqual({ drawn: PICTURE });
    expect(shots.asked).toBe(1);
  });

  it("draws a picture that could not be drawn at the next refresh, not before", async () => {
    shots.next = [null, PICTURE];
    const thread = threadOn("timed-out");
    await refreshPreviews([thread]);
    expect(useThreadPreviews.getState().pictures).toEqual({});
    expect(shots.asked).toBe(1);
    await refreshPreviews([thread]);
    expect(useThreadPreviews.getState().pictures).toEqual({
      "timed-out": PICTURE,
    });
  });

  it("draws the other threads' when one's drawing throws, and that one's next time", async () => {
    shots.next = [new Error("no frame"), PICTURE, PICTURE];
    const threads = [threadOn("thrown"), threadOn("after")];
    await refreshPreviews(threads);
    expect(useThreadPreviews.getState().pictures).toEqual({ after: PICTURE });
    await refreshPreviews(threads);
    expect(useThreadPreviews.getState().pictures).toEqual({
      after: PICTURE,
      thrown: PICTURE,
    });
    expect(shots.asked).toBe(3);
  });
});
