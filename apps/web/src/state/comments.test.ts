import "../testing/fake-browser.ts";
import type { Comment } from "@ultrapaint/contracts/comments";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import {
  behaviourNotesOf,
  type CommentGround,
  commentFrame,
  holdsCard,
  openComment,
  postDraft,
  startComment,
  useComments,
} from "./comments.ts";
import { useEditor } from "./editor.ts";
import { nodeFrameOf, viewFrameOf } from "./frame-ref.ts";
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
  page: string | null;
  text: string;
  view?: string | null;
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
  view: input.view ?? null,
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
  it("is the page's, written in that view alone, at the point clicked, a whole pixel", () => {
    startComment(TABLET, { x: 120.4, y: 80.6 }, title);
    expect(useComments.getState().draft).toMatchObject({
      frame: TABLET,
      nodeId: "title",
      pageId: HOME,
      x: 120,
      y: 81,
    });
    expect(holdsCard(useComments.getState(), TABLET)).toBe(true);
    expect(holdsCard(useComments.getState(), HOME)).toBe(false);
  });

  it("is posted on the page, in that view", async () => {
    startComment(TABLET, { x: 120, y: 80 }, title);
    await postDraft("Bigger");
    expect(fakeApi.calls).toMatchObject([
      {
        input: {
          canvas: "main",
          nodeId: "title",
          page: HOME,
          text: "Bigger",
          view: "tablet",
          x: 120,
          y: 80,
        },
        method: "comments.create",
      },
    ]);
    expect(useComments.getState()).toMatchObject({ draft: null, open: "c1" });
  });
});

describe("a comment started on the canvas", () => {
  it("is on no page, at the point of the canvas, and a plain comment", async () => {
    startComment(null, { x: -40.2, y: 300.7 });
    expect(holdsCard(useComments.getState(), null)).toBe(true);
    await postDraft("What goes here?", "behaviour");
    expect(fakeApi.calls).toMatchObject([
      {
        input: {
          kind: "comment",
          nodeId: null,
          page: null,
          view: null,
          x: -40,
          y: 301,
        },
        method: "comments.create",
      },
    ]);
  });

  it("on a node beside the pages is on that node, in its frame's pixels", async () => {
    startComment(nodeFrameOf("card"), { x: 12, y: 8 }, title);
    await postDraft("Rounder");
    expect(fakeApi.calls).toMatchObject([
      {
        input: { nodeId: "title", page: null, view: null, x: 12, y: 8 },
        method: "comments.create",
      },
    ]);
  });
});

describe("where a comment is drawn", () => {
  const ground: CommentGround = {
    nodeFrame: (id) => (id === "title" ? nodeFrameOf("card") : null),
    pageId: (path) => (path === HOME ? HOME : undefined),
    views: (page) => (page === HOME ? ["tablet"] : []),
  };
  const at = (change: Partial<Comment>) =>
    commentFrame(
      {
        ...posted({
          element: null,
          nodeId: null,
          page: HOME,
          text: "",
          x: 1,
          y: 1,
        }),
        ...change,
      },
      ground
    );

  it("is in the frame it was left in alone: the page's own, or its view", () => {
    expect(at({})).toBe(HOME);
    expect(at({ view: "tablet" })).toBe(TABLET);
  });

  it("is in the page's own frame once its view is taken away", () => {
    expect(at({ view: "mobile" })).toBe(HOME);
  });

  it("is in a node's frame beside the pages, else on the canvas itself", () => {
    expect(at({ nodeId: "title", page: null })).toBe(nodeFrameOf("card"));
    expect(at({ nodeId: null, page: null })).toBeNull();
    // Its node gone, or moved into a page, it stays on the canvas.
    expect(at({ nodeId: "gone", page: null })).toBeNull();
  });

  it("is nowhere when its page is not on the canvas", () => {
    expect(at({ page: "about.page.json" })).toBeUndefined();
  });
});

describe("the behaviour notes of what is selected", () => {
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
  const comments = [
    note("page", {}),
    note("on-root", { nodeId: "root", x: 40, y: 12 }),
    note("title", { nodeId: "title" }),
    note("talk", { kind: "comment" }),
    note("done", { resolved: true }),
    note("elsewhere", { page: "about.page.json" }),
  ];
  const ids = (notes: readonly Comment[]) => notes.map((c) => c.id);

  it("of the page are its open notes on no element or on its root", () => {
    expect(ids(behaviourNotesOf(comments, HOME, { rootId: "root" }))).toEqual([
      "page",
      "on-root",
    ]);
  });

  it("of an element are its open notes, placed or not", () => {
    expect(ids(behaviourNotesOf(comments, HOME, { nodeId: "title" }))).toEqual([
      "title",
    ]);
  });

  it("open their card with the comments shown", () => {
    useComments.setState({ visible: false });
    openComment("page");
    expect(useComments.getState()).toMatchObject({
      open: "page",
      visible: true,
    });
  });
});
