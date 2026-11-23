import "../testing/fake-browser.ts";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useComponents } from "../state/components.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { makeProperty } from "./instance-overrides.ts";

vi.mock("../components/dialogs.tsx", async (original) => ({
  ...(await original<typeof import("../components/dialogs.tsx")>()),
  promptDialog: () => Promise.resolve("label"),
}));

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const HOME = "home.page.json";

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
  useProject.setState({
    info: { configured: true, storage: { mode: "managed" } },
  } as never);
  useEditor.setState({ canvas: "main" });
  useComponents.setState({
    components: [
      {
        name: "Promo",
        origin: "app",
        properties: [],
        slots: [],
        tree: {
          children: [
            { id: "sale", role: "paragraph", text: "Sale", type: "text" },
          ],
          id: "p-root",
          type: "column",
        },
        version: 1,
      },
    ],
  });
  useDocuments.setState({
    canvas: "main",
    docs: {
      [HOME]: {
        doc: HOME,
        hash: `${HOME}@0`,
        root: {
          children: [
            {
              component: "Promo",
              from: "#app",
              id: "promo",
              overrides: { sale: { text: "Mine" } },
              type: "instance",
            },
          ],
          id: "home",
          type: "page",
        } as DesignNode,
      },
    },
  });
});

const applied = () =>
  fakeApi.calls
    .filter((c) => c.method === "documents.apply")
    .map((c) => (c.input as { edits: { ops: unknown[] }[] }).edits[0]?.ops);

describe("a layer's overridden field made a property (ADR 0114)", () => {
  it("gives the instance its override back when the component refuses the property", async () => {
    // No answer is set up for components.change: the server refuses it.
    await makeProperty(HOME, "promo/sale", {
      at: null,
      field: "text",
      value: "Mine",
    });
    expect(applied()).toEqual([
      [
        { id: "promo/sale", op: "update", set: { text: null } },
        { id: "promo", op: "setProps", props: { label: "Mine" } },
      ],
      [
        { id: "promo", op: "setProps", props: { label: null } },
        { id: "promo/sale", op: "update", set: { text: "Mine" } },
      ],
    ]);
  });

  it("moves the value onto the instance, then gives the component the property", async () => {
    fakeApi.respond("components.change", () => ({}) as never);
    await makeProperty(HOME, "promo/sale", {
      at: null,
      field: "text",
      value: "Mine",
    });
    expect(applied()).toHaveLength(1);
    expect(
      fakeApi.calls.find((c) => c.method === "components.change")?.input
    ).toMatchObject({
      change: {
        op: "addProperty",
        property: { default: "Sale", kind: "text", name: "label" },
      },
      name: "Promo",
    });
  });
});
