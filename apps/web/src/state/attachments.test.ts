import "../testing/fake-browser.ts";
import type { Comment } from "@ultrapaint/contracts/comments";
import type { Page } from "@ultrapaint/contracts/pages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imageChip } from "../lib/file-chips.ts";
import {
  addChip,
  attachmentsOf,
  type Chip,
  chipKey,
  chipOfAttachment,
  chipOfComment,
  clearChips,
  dismissChip,
  dropChips,
  fileOfFrame,
  useAttachments,
} from "./attachments.ts";
import { viewFrameOf } from "./frame-ref.ts";
import { useProject } from "./project.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const page = (pageId: string): Chip => ({
  file: `designs/${pageId}.page.json`,
  kind: "page",
  name: pageId,
  pageId,
});

const node = (pageId: string, nodeId: string, component = false): Chip => ({
  component,
  file: `designs/${pageId}.page.json`,
  frame: pageId,
  kind: "node",
  name: nodeId,
  nodeId,
});

beforeEach(() => {
  useAttachments.setState({ byThread: {}, dismissed: {} });
});

describe("clearChips", () => {
  it("keeps a chip attached while the prompt was being sent", () => {
    addChip("t1", page("home"));
    const sent = useAttachments.getState().byThread.t1 ?? [];
    addChip("t1", page("pricing"));
    clearChips("t1", sent);
    expect(useAttachments.getState().byThread.t1).toEqual([page("pricing")]);
  });

  it("forgets the thread once every chip has gone", () => {
    addChip("t1", page("home"));
    clearChips("t1", [page("home")]);
    expect(useAttachments.getState().byThread).toEqual({});
  });

  it("lets what was taken out of the prompt go along with the next one", () => {
    dismissChip("t1", chipKey(node("home", "cta")));
    dismissChip("t2", chipKey(node("home", "cta")));
    clearChips("t1", []);
    expect(useAttachments.getState().dismissed).toEqual({
      t2: [chipKey(node("home", "cta"))],
    });
    dropChips("t2");
    expect(useAttachments.getState().dismissed).toEqual({});
  });
});

describe("attachmentsOf", () => {
  it("sends each file once, before the first of its nodes", () => {
    expect(
      attachmentsOf([
        node("home", "hero"),
        page("pricing"),
        node("home", "card", true),
        page("home"),
      ])
    ).toEqual([
      { kind: "file", path: "designs/home.page.json" },
      {
        file: "designs/home.page.json",
        kind: "selection",
        name: "hero",
        nodeId: "hero",
      },
      { kind: "file", path: "designs/pricing.page.json" },
      {
        component: true,
        file: "designs/home.page.json",
        kind: "selection",
        name: "card",
        nodeId: "card",
      },
    ]);
  });

  it("sends nothing for no chips", () => {
    expect(attachmentsOf([])).toEqual([]);
  });

  const home = {
    file: "designs/home.page.json",
    id: "home",
    name: "Home",
    path: "home.page.json",
  } as Page;
  const comment = (nodeId: string | null, element: string | null) =>
    ({ element, nodeId, page: "home.page.json" }) as Comment;

  it("sends a comment's page and the node it is pinned on, by the comment's name for it", () => {
    expect(
      attachmentsOf([chipOfComment(comment("cta", "Button"), home)])
    ).toEqual([
      { kind: "file", path: "designs/home.page.json" },
      {
        file: "designs/home.page.json",
        kind: "selection",
        name: "Button",
        nodeId: "cta",
      },
    ]);
    expect(
      attachmentsOf([chipOfComment(comment("cta", null), home)])[1]
    ).toMatchObject({ name: "node" });
  });

  it("sends a comment on the page itself as the page", () => {
    expect(attachmentsOf([chipOfComment(comment(null, null), home)])).toEqual([
      { kind: "file", path: "designs/home.page.json" },
    ]);
  });

  it("sends a pasted image as the picture, each one however it is named", () => {
    const shot = imageChip("Pasted image", "data:image/png;base64,AAAA");
    const again = imageChip("Pasted image", "data:image/png;base64,BBBB");
    expect(chipKey(shot)).not.toBe(chipKey(again));
    expect(attachmentsOf([page("home"), shot])).toEqual([
      { kind: "file", path: "designs/home.page.json" },
      {
        dataUrl: "data:image/png;base64,AAAA",
        kind: "image",
        name: "Pasted image",
      },
    ]);
  });
});

describe("chipOfAttachment", () => {
  it("puts a queued prompt's picture back as an image chip", () => {
    const chip = chipOfAttachment({
      dataUrl: "data:image/png;base64,AAAA",
      kind: "image",
      name: "Home screenshot",
    });
    expect(chip && attachmentsOf([chip])).toEqual([
      {
        dataUrl: "data:image/png;base64,AAAA",
        kind: "image",
        name: "Home screenshot",
      },
    ]);
  });
});

describe("fileOfFrame", () => {
  afterEach(() => {
    useProject.setState({ pages: [] });
  });

  it("names the page's file for a node selected in one of its views", () => {
    useProject.setState({
      pages: [
        {
          canvas: "",
          file: "designs/home.page.json",
          id: "home",
          name: "Home",
          path: "home.page.json",
        } as Page,
      ],
    });
    expect(fileOfFrame("home")).toBe("designs/home.page.json");
    expect(fileOfFrame(viewFrameOf("home", "tablet"))).toBe(
      "designs/home.page.json"
    );
  });
});
