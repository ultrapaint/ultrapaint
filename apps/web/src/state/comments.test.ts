import "../testing/fake-browser.ts";
import type { Comment } from "@ultrapaint/contracts/comments";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import {
  behaviourNotesOf,
  openComment,
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
