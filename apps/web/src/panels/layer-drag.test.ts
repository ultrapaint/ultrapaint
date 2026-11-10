// @vitest-environment happy-dom
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import { catalogueOf } from "@ultrapaint/system-components/catalogue";
import type { DragEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useComponents } from "../state/components.ts";
import { type Dragging, rowDrop } from "./layer-drag.ts";
import { type DropPosition, type LayerItem, pageItem } from "./layer-tree.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const page: Page = {
  canvas: "",
  file: "designs/home.page.json",
  id: "home",
  name: "Home",
  path: "home.page.json",
};

const instance = (id: string, component: string, from: string): DesignNode =>
  ({ component, from, id, type: "instance" }) as DesignNode;

const title: DesignNode = {
  id: "title",
  role: "paragraph",
  text: "Welcome",
  type: "text",
};

/** Plan, an app component whose slots are all named: what goes in names its slot. */
const plan: ComponentMeta = {
  category: "app",
  importFrom: "#app",
  name: "Plan",
  props: [],
  slots: [
    { label: "Plan", name: "root" },
    { holds: "nodes", label: "Features", name: "features" },
  ],
  variants: {},
};

/** The rows of a page holding a title, a Card and a Plan. */
const rows = () => {
  const root: DesignNode = {
    children: [
      title,
      instance("card", "Card", "@ultrapaint/system"),
      instance("plan", "Plan", "#app"),
    ],
    id: "root",
    type: "page",
  };
  const [titleRow, cardRow, planRow] = pageItem(page, root)
    .children as LayerItem[];
  return {
    card: cardRow as LayerItem,
    plan: planRow as LayerItem,
    title: titleRow as LayerItem,
  };
};

/** The title's row dragged over `over`, `y` of the way down it, and dropped there. */
const dropTitleOn = (over: LayerItem, y: number) => {
  const { title: dragged } = rows();
  const onDrop = vi.fn(
    async (_over: LayerItem, _position: DropPosition) => undefined
  );
  const dragging: Dragging = {
    drag: dragged,
    onCanvas: true,
    onDrop,
    setDrag: () => undefined,
  };
  const event = {
    clientY: y * 20,
    currentTarget: { getBoundingClientRect: () => ({ height: 20, top: 0 }) },
    preventDefault: () => undefined,
  } as unknown as DragEvent<HTMLDivElement>;
  const row = rowDrop(over, dragging);
  row.onDragOver(event);
  row.onDrop(event);
  return onDrop.mock.calls.map(([, position]) => position);
};

describe("a layer dropped on an instance's row (review D1)", () => {
  afterEach(() => {
    useComponents.setState({ catalogue: catalogueOf([]) });
  });

  it("goes inside a component with a default slot, a Card, over its middle", () => {
    expect(dropTitleOn(rows().card, 0.5)).toEqual(["inside"]);
    // Over its top, before it.
    expect(dropTitleOn(rows().card, 0.1)).toEqual(["before"]);
  });

  it("goes only beside a component whose slots are all named", () => {
    useComponents.setState({ catalogue: [...catalogueOf([]), plan] });
    expect(dropTitleOn(rows().plan, 0.45)).toEqual(["before"]);
    expect(dropTitleOn(rows().plan, 0.55)).toEqual(["after"]);
  });
});
