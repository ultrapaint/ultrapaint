/**
 * The Library's places and their boards (ADR 0045): the Overview, every component in its default
 * look, and a component's matrix, every member of an axis in each state, drawn by the component
 * itself. Generated documents the canvas's renderer draws, pure. A node a board draws for
 * something that can be picked is named for it: a component on the Overview (`item:Button`),
 * which a click opens.
 */
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import {
  APP_FROM,
  COMPONENT_STATES,
  type ComponentFile,
  type ComponentState,
  SYSTEM_FROM,
  type SystemComponentFile,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { STATE_ATTRIBUTE } from "@ultrapaint/design-document/component-look";
import { newInstance } from "@ultrapaint/design-document/factories";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import { tokenRef } from "@ultrapaint/design-document/tokens";
import type { Board, Boards } from "./system-boards.ts";

/** The Library's first item: every component, one click away from its board. */
export const OVERVIEW = "overview";

/** The axes and members a look is drawn in: the catalogue's, and its own besides. */
export const axesOf = (
  spec: SystemComponentFile,
  meta: ComponentMeta | undefined
) => {
  const axes: Record<string, string[]> = {};
  for (const [axis, members] of Object.entries(meta?.variants ?? {})) {
    axes[axis] = [...members];
  }
  for (const [axis, members] of Object.entries(spec.variants)) {
    axes[axis] = [...new Set([...(axes[axis] ?? []), ...Object.keys(members)])];
  }
  return axes;
};

/** The axis the matrix draws a row per member of: the one asked for, else one a state is set in a member of, else the first. */
export const rowAxisOf = (
  component: SystemComponentFile,
  axes: Readonly<Record<string, readonly string[]>>,
  asked: string | undefined
) => {
  const names = Object.keys(axes);
  if (asked && names.includes(asked)) {
    return asked;
  }
  return (
    names.find((a) => component.variantStates?.[a] !== undefined) ?? names[0]
  );
};

/** The states a look is drawn in: those it sets, in every member or in one, and the usual three. */
export const drawnStates = (
  component: SystemComponentFile
): ComponentState[] => {
  const set = new Set<string>(Object.keys(component.states));
  for (const members of Object.values(component.variantStates ?? {})) {
    for (const states of Object.values(members)) {
      for (const s of Object.keys(states)) {
        set.add(s);
      }
    }
  }
  return COMPONENT_STATES.filter(
    (s) => set.has(s) || ["hover", "focus", "disabled"].includes(s)
  );
};

/**
 * The matrix the preview draws: a row per member of an axis (the default alone when there is
 * none), a column for the base and each state, every cell the real component pinned in it, so
 * each member shows each state with its own values. An app component is drawn once, as an
 * instance with its properties' defaults.
 */
export const matrixOf = (
  component: ComponentFile,
  meta: ComponentMeta | undefined,
  pageWidth: number,
  rowAxis: string | undefined,
  /** A row of many states goes on below, as in a narrow panel; on a board it stays one row. */
  wrap = true
): DesignNode => {
  if (component.origin === "app") {
    // At its own width when it has one, else as wide as a page: a header that fills a page is
    // not squeezed into the panel, the picture is scaled down to it instead.
    const { width } = component.tree;
    return {
      children: [
        {
          component: component.name,
          from: APP_FROM,
          id: "cell-app",
          type: "instance",
        },
      ],
      id: "matrix",
      padding: 12,
      type: "column",
      width: typeof width === "number" ? width + 24 : pageWidth,
    };
  }
  const axes = axesOf(component, meta);
  const axis = rowAxisOf(component, axes, rowAxis);
  const members = axis ? (axes[axis] ?? []) : [];
  const states: (ComponentState | null)[] = [null, ...drawnStates(component)];
  const rows = (members.length > 0 ? members : [null]).map(
    (member, r): DesignNode => ({
      children: states.map(
        (state): DesignNode => ({
          component: component.name,
          from: SYSTEM_FROM,
          // Named for what it stands for (B6): a click on it picks that member in that state.
          id: `cell:${member ?? "default"}:${state ?? "base"}`,
          props: {
            ...(axis && member ? { [axis]: member } : {}),
            ...(state ? { [STATE_ATTRIBUTE]: state } : {}),
            ...(state === "disabled" ? { disabled: true } : {}),
          },
          text: component.name,
          type: "instance",
        })
      ),
      crossAlign: "center",
      gap: 8,
      id: `row-${r}`,
      type: "row",
      wrap,
    })
  );
  return {
    children: rows,
    gap: 12,
    id: "matrix",
    padding: 12,
    type: "column",
    width: "fill",
  };
};

/** Four tiles a row, and their gaps and margins. */
const OVERVIEW_WIDTH = 4 * 200 + 3 * 12 + 2 * 24;

/** How wide a board draws what a page would fill: an app component without a width of its own. */
const BOARD_PAGE_WIDTH = 1200;

/** A board's root: a sheet of the design's background, at a width of its own. */
const sheet = (
  id: string,
  children: DesignNode[],
  width: number | "fill"
): DesignNode => ({
  children,
  fill: tokenRef("color-background"),
  gap: 24,
  id,
  padding: 24,
  radius: 8,
  type: "column",
  width,
});

/**
 * A component as its catalogue's example has it, closed when the example is open: a dialog drawn
 * open covers the whole board, and a toast goes to its corner.
 */
const exampleOf = (
  c: ComponentMeta,
  next: ReturnType<typeof makeIdGenerator>
): DesignNode => {
  const instance = newInstance(c, next);
  return instance.props?.open === true
    ? { ...instance, props: { ...instance.props, open: false } }
    : instance;
};

/**
 * Every component in its default look, App components then System components, each in a tile
 * named for it (`item:<Name>`) under its name.
 */
export const overviewBoard = (catalogue: readonly ComponentMeta[]): Board => {
  const next = makeIdGenerator();
  const section = (
    title: string,
    items: readonly ComponentMeta[]
  ): DesignNode => ({
    children: [
      {
        color: "#71717a",
        id: `section-label:${title}`,
        role: "paragraph",
        size: 12,
        text: title,
        type: "text",
      },
      {
        children: items.map(
          (c): DesignNode => ({
            border: { color: "#0000001a", width: 1 },
            children: [
              {
                align: "center",
                children: [{ ...exampleOf(c, next), id: `example:${c.name}` }],
                crossAlign: "center",
                height: 96,
                id: `stage:${c.name}`,
                type: "row",
                width: "fill",
              },
              {
                id: `title:${c.name}`,
                role: "paragraph",
                size: 13,
                text: c.name,
                type: "text",
              },
            ],
            gap: 8,
            id: `item:${c.name}`,
            padding: 12,
            radius: 8,
            type: "column",
            width: 200,
          })
        ),
        gap: 12,
        id: `section-items:${title}`,
        type: "row",
        wrap: true,
      },
    ],
    gap: 8,
    id: `section:${title}`,
    type: "column",
  });
  const byName = [...catalogue].sort((a, b) => a.name.localeCompare(b.name));
  const app = byName.filter((c) => c.importFrom === APP_FROM);
  const system = byName.filter((c) => c.importFrom !== APP_FROM);
  return {
    name: "overview",
    root: sheet(
      "overview",
      [
        ...(app.length > 0 ? [section("App components", app)] : []),
        section("System components", system),
      ],
      OVERVIEW_WIDTH
    ),
    title: "Every component",
  };
};

/**
 * The boards of an item of the Library: the Overview's, or a component's matrix (a system
 * component in its file, or its default look when the project has none). None for a component
 * the Library does not have.
 */
export const libraryBoards = (
  item: string,
  catalogue: readonly ComponentMeta[],
  fileOf: (name: string) => ComponentFile | undefined
): Boards => {
  if (item === OVERVIEW) {
    return { boards: [overviewBoard(catalogue)], direction: "column" };
  }
  const meta = catalogue.find((c) => c.name === item);
  const file = fileOf(item);
  if (!file) {
    return { boards: [], direction: "column" };
  }
  const matrix = matrixOf(file, meta, BOARD_PAGE_WIDTH, undefined, false);
  return {
    boards: [
      {
        name: "matrix",
        // At its own size: the panel's matrix fills the panel, a board's is as wide as its states.
        root: {
          ...matrix,
          fill: tokenRef("color-background"),
          padding: 24,
          radius: 8,
          ...(file.origin === "system" && { width: "hug" as const }),
        },
        title: file.origin === "app" ? "as an instance" : "variant × state",
      },
    ],
    direction: "column",
  };
};
