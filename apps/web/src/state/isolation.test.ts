import "../testing/fake-browser.ts";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateOpsAt } from "../lib/breakpoint-edits.ts";
import { useComponents } from "./components.ts";
import { docOfFrame, nodeIn, useDocuments } from "./documents.ts";
import { useEditor } from "./editor.ts";
import {
  editVariant,
  isolate,
  leaveIsolation,
  startIsolation,
  useIsolation,
} from "./isolation.ts";
import { frameBreakpoint } from "./selection.ts";
import { surfaceNow } from "./surface.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const HOME = "home.page.json";

const stateOf = (doc: string, root: DesignNode): DocumentState => ({
  doc,
  hash: `${doc}@0`,
  root,
});

const PROMO = {
  component: "Promo",
  from: "#app",
  id: "promo",
  type: "instance",
} as const;

const TITLE: DesignNode = {
  id: "title",
  role: "heading",
  text: "Sale",
  type: "text",
};

/** What the edit in place follows, started for each test and stopped after it. */
let stop: () => void = () => undefined;

afterEach(() => {
  stop();
});

beforeEach(() => {
  stop = startIsolation();
  leaveIsolation();
  useEditor.setState({ canvas: "", selection: null });
  useDocuments.setState({
    canvas: "",
    docs: {
      [HOME]: stateOf(HOME, {
        children: [PROMO],
        id: "home",
        type: "page",
      }),
    },
  });
  useComponents.setState({
    components: [
      {
        name: "Promo",
        origin: "app",
        properties: [
          {
            default: "plain",
            kind: "choice",
            members: ["plain", "loud"],
            name: "tone",
          },
        ],
        slots: [],
        tree: { children: [TITLE], id: "p-root", type: "column" },
        version: 1,
      },
    ],
  });
});

describe("an app component edited in place", () => {
  it("takes the frame's selection and edits to the component's tree, and gives them back", () => {
    expect(isolate(HOME, PROMO)).toBe(true);
    expect(docOfFrame(HOME, "")).toBe("component:Promo");
    expect(useEditor.getState().selection).toEqual({
      frame: HOME,
      nodeId: "p-root",
    });
    expect(nodeIn(useDocuments.getState().docs, "", HOME, "title")).toEqual(
      TITLE
    );
    leaveIsolation();
    expect(docOfFrame(HOME, "")).toBe(HOME);
    expect(useEditor.getState().selection).toEqual({
      frame: HOME,
      nodeId: "promo",
    });
  });

  it("is edited on a board's instance at a member, without a selection of its own, and left selecting nothing", () => {
    const board = "board:library/Promo/tone=loud";
    useEditor.setState({ selection: { frame: board, nodeId: "title" } });
    expect(
      isolate(
        board,
        { ...PROMO, id: "instance", props: { tone: "loud" } },
        { select: false, variant: { member: "loud", property: "tone" } }
      )
    ).toBe(true);
    expect(docOfFrame(board, "")).toBe("component:Promo");
    expect(frameBreakpoint(board)).toBe("tone=loud");
    expect(useEditor.getState().selection).toEqual({
      frame: board,
      nodeId: "title",
    });
    leaveIsolation();
    expect(docOfFrame(board, "")).toBe(board);
    expect(useEditor.getState().selection).toBeNull();
  });

  it("is left by a press on the ground, letting the selection go", () => {
    isolate(HOME, PROMO);
    surfaceNow().onGroundPress();
    expect(useIsolation.getState().isolated).toBeNull();
    expect(docOfFrame(HOME, "")).toBe(HOME);
    expect(useEditor.getState().selection).toBeNull();
  });

  it("lands an edit on the member of a choice being edited, as a breakpoint's", () => {
    isolate(HOME, PROMO);
    editVariant({ member: "loud", property: "tone" });
    expect(frameBreakpoint(HOME)).toBe("tone=loud");
    expect(updateOpsAt(TITLE, HOME, { size: 32 })).toEqual([
      { at: "tone=loud", id: "title", op: "update", set: { size: 32 } },
    ]);
    editVariant(null);
    expect(frameBreakpoint(HOME)).toBeNull();
  });

  it("keeps the tree an edit gave it while the components' news is on its way", () => {
    isolate(HOME, PROMO);
    const doc = "component:Promo";
    const edited: DesignNode = {
      children: [{ ...TITLE, text: "Big sale" }],
      id: "p-root",
      type: "column",
    };
    // The edit's answer comes first; the file the components list has is still the old one.
    useDocuments.getState().put({ doc, hash: "h1", root: edited });
    expect(useDocuments.getState().docs[doc]?.root).toEqual(edited);
    useComponents.setState({
      components: [...useComponents.getState().components],
    });
    expect(useDocuments.getState().docs[doc]?.root).toEqual(edited);
    // A canvas read again starts it from the file once more.
    useDocuments.setState({ docs: {} });
    expect(nodeIn(useDocuments.getState().docs, "", HOME, "title")).toEqual(
      TITLE
    );
  });

  it("leaves an app component edited inside another's tree for the page's instance it was entered from", () => {
    const badge = {
      component: "Badge2",
      from: "#app",
      id: "p-badge",
      type: "instance",
    } as const;
    useComponents.setState({
      components: [
        ...useComponents.getState().components,
        {
          name: "Badge2",
          origin: "app",
          properties: [],
          slots: [],
          tree: { children: [], id: "b-root", type: "row" },
          version: 1,
        },
      ],
    });
    isolate(HOME, PROMO);
    expect(isolate(HOME, badge)).toBe(true);
    expect(docOfFrame(HOME, "")).toBe("component:Badge2");
    leaveIsolation();
    expect(useEditor.getState().selection).toEqual({
      frame: HOME,
      nodeId: "promo",
    });
  });

  it("is no node but an app component's instance's", () => {
    expect(isolate(HOME, { ...PROMO, from: "@ultrapaint/system" })).toBe(false);
    expect(useIsolation.getState().isolated).toBeNull();
  });
});
