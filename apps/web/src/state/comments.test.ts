import "../testing/fake-browser.ts";
import type { Comment } from "@ultrapaint/contracts/comments";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import {
  openComment,
  pageNotesOf,
  postDraft,
  startComment,
  useComments,
} from "./comments.ts";
import { useEditor } from "./editor.ts";
import { viewFrameOf } from "./frame-ref.ts";
import { useProject } from "./project.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const HOME = "home.page.json";
/** A view of the home page: the page drawn again at another width (ADR 0036). */
const TABLET = viewFrameOf(HOME, "tablet");

const title = {
  id: "title",
  role: "heading",
  text: "Welcome",
  type: "text",
} as DesignNode;

const posted = (input: {
  element: string | null;
  nodeId: string | null;
  page: string;
  text: string;
  x: number;
  y: number;
}): Comment => ({
  ...input,
  author: null,
  createdAt: 1,
  id: "c1",
  kind: "comment",
  replies: [],
  resolved: false,
  updatedAt: 1,
});

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("comments.create", posted);
  useProject.setState({
    pages: [
      {
        canvas: "main",
        file: `designs/main/${HOME}`,
        id: HOME,
        name: "Home",
        path: HOME,
      },
    ],
  });
  useEditor.setState({ canvas: "main" });
  useComments.setState({
    canvas: "main",
    comments: [],
    draft: null,
    open: null,
    visible: true,
  });
});

describe("a comment started on a view of a page", () => {
  it("is the page's, at the point clicked, a whole pixel", () => {
    startComment(TABLET, { x: 120.4, y: 80.6 }, title);
    expect(useComments.getState().draft).toMatchObject({
      nodeId: "title",
      pageId: HOME,
      x: 120,
      y: 81,
    });
  });

  it("is posted on the page", async () => {
    startComment(TABLET, { x: 120, y: 80 }, title);
    await postDraft("Bigger");
    expect(fakeApi.calls).toMatchObject([
      {
        input: {
          canvas: "main",
          nodeId: "title",
          page: HOME,
          text: "Bigger",
          x: 120,
          y: 80,
        },
        method: "comments.create",
      },
    ]);
    expect(useComments.getState()).toMatchObject({ draft: null, open: "c1" });
  });
});

describe("the notes on a page as a whole", () => {
  const note = (id: string, change: Partial<Comment>): Comment => ({
    ...posted({
      element: null,
      nodeId: null,
      page: HOME,
      text: "Only admins see this",
      x: 0,
      y: 0,
    }),
    id,
    kind: "behaviour",
    ...change,
  });

  it("are the page's open comments that were never placed on it", () => {
    const comments = [
      note("tool", {}),
      note("placed", { x: 40, y: 12 }),
      note("done", { resolved: true }),
      note("elsewhere", { page: "about.page.json" }),
    ];
    expect(pageNotesOf(comments, HOME).map((c) => c.id)).toEqual(["tool"]);
  });

  it("open their card with the comments shown", () => {
    useComments.setState({ visible: false });
    openComment("tool");
    expect(useComments.getState()).toMatchObject({
      open: "tool",
      visible: true,
    });
  });
});
