import "../testing/fake-browser.ts";
import type {
  DesignNode,
  DocumentState,
} from "@ultrapaint/contracts/document";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateOpsAt } from "../lib/breakpoint-edits.ts";
import { useComponents } from "./components.ts";
import { docOfFrame, nodeIn, useDocuments } from "./documents.ts";
import { useEditor } from "./editor.ts";
import {
  editVariant,
  isolate,
  leaveIsolation,
  useIsolation,
} from "./isolation.ts";
import { frameBreakpoint } from "./selection.ts";

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

beforeEach(() => {
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

  it("is no node but an app component's instance's", () => {
    expect(isolate(HOME, { ...PROMO, from: "@ultrapaint/system" })).toBe(
      false
    );
    expect(useIsolation.getState().isolated).toBeNull();
  });
});
