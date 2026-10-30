/**
 * The Library's places and their boards (ADR 0045): the Overview, every component in its default
 * look; a system component's matrix, every member of an axis in each state under the states'
 * names, and a board a further axis, its members side by side; an app component's variants, a
 * board a member of each choice, each an instance drawn live. Generated documents the canvas's
 * renderer draws, pure. A node a board draws for something that can be picked is named for it: a
 * component on the Overview (`item:Button`), which a click opens, and a cell for the place of the
 * look it shows (`cell:variant=outline:hover`), which a click picks.
 */
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import {
  APP_FROM,
  type AppComponentFile,
  COMPONENT_STATES,
  type ComponentFile,
  type ComponentState,
  type LookPlace,
  SYSTEM_FROM,
  type SystemComponentFile,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { STATE_ATTRIBUTE } from "@ultrapaint/design-document/component-look";
import { newInstance } from "@ultrapaint/design-document/factories";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import { tokenRef } from "@ultrapaint/design-document/tokens";
import { label } from "./board-nodes.ts";
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
 * The matrix the Components tab's preview draws (a board's is `systemComponentBoards`'s): a row per member of an axis (the default alone when there is
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

/** How wide a board draws what a page would fill: an app component without a width of its own. */
const BOARD_PAGE_WIDTH = 1200;

/** What a tile shows a component in: its width but its padding. */
export const STAGE_WIDTH = 200 - 2 * 12;

/** How much the Overview scales an app component drawn `width` wide to fit its tile. */
export const stageScale = (width: number) =>
  width > STAGE_WIDTH ? STAGE_WIDTH / width : 1;

/** How wide an app component's tree draws by itself; null when it hugs what it holds. */
const drawnWidth = (tree: DesignNode): number | null => {
  const { width } = tree as { width?: unknown };
  if (typeof width === "number") {
    return width;
  }
  return width === "fill" ? BOARD_PAGE_WIDTH : null;
};

const NODE = "data-ed-node";

/**
 * How wide the Overview drew its app components, from what it measured of them (`example:<Name>`)
 * drawn at the scale the widths it knew gave them: the same record while none moved by a pixel or
 * more, so that drawing them again at the scale they give measures them the same.
 */
export const drawnWidths = (
  apps: readonly string[],
  rects: Readonly<Record<string, { readonly width: number }>>,
  was: Readonly<Record<string, number>>
): Readonly<Record<string, number>> => {
  const next: Record<string, number> = {};
  for (const name of apps) {
    const rect = rects[`example:${name}`];
    const known = was[name];
    // Measured as scaled: its own width is the scale undone.
    const width = rect
      ? rect.width / (known === undefined ? 1 : stageScale(known))
      : known;
    if (width !== undefined) {
      next[name] =
        known !== undefined && Math.abs(known - width) < 1 ? known : width;
    }
  }
  const same =
    Object.keys(next).length === Object.keys(was).length &&
    Object.entries(next).every(([k, v]) => was[k] === v);
  return same ? was : next;
};

/**
 * The Overview's stylesheet: a tile shows what fits in it, and an app component wider than a tile
 * scaled down to it (a document cannot scale what it draws; B12's one exception, a board's own).
 */
const overviewCss = (
  wide: readonly { readonly name: string; readonly width: number }[]
) =>
  [
    `[${NODE}^="stage:"] { overflow: hidden; justify-content: safe center; }`,
    ...wide.map(
      (w) =>
        `[${NODE}="example:${w.name}"] { zoom: ${stageScale(w.width).toFixed(4)}; flex-shrink: 0; }`
    ),
  ].join("\n");

/** Four tiles a row, and their gaps and margins. */
const OVERVIEW_WIDTH = 4 * 200 + 3 * 12 + 2 * 24;

/** A board's root: a sheet of the design's background, at a width of its own. */
const sheet = (
  id: string,
  children: DesignNode[],
  width: number | "fill" | "hug"
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
export const overviewBoard = (
  catalogue: readonly ComponentMeta[],
  fileOf: (name: string) => ComponentFile | undefined = () => undefined,
  /** How wide the app components that hug what they hold were drawn, by name. */
  drawn: Readonly<Record<string, number>> = {}
): Board => {
  const next = makeIdGenerator();
  // An app component wider than a tile is drawn at its width and scaled down to the tile: the
  // width its tree gives, else the one it was drawn at.
  const widths = new Map(
    catalogue.flatMap((c) => {
      const file = c.importFrom === APP_FROM ? fileOf(c.name) : undefined;
      const own = file?.origin === "app" ? drawnWidth(file.tree) : null;
      const width = own ?? drawn[c.name];
      return width === undefined ? [] : [[c.name, { own, width }] as const];
    })
  );
  const wide = [...widths].flatMap(([name, { width }]) =>
    width > STAGE_WIDTH ? [{ name, width }] : []
  );
  const example = (c: ComponentMeta): DesignNode => {
    const own = widths.get(c.name)?.own;
    return {
      ...exampleOf(c, next),
      id: `example:${c.name}`,
      ...(typeof own === "number" && { width: own }),
    } as DesignNode;
  };
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
                children: [example(c)],
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
    css: overviewCss(wide),
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

// ---- A system component's board ----

const CELL_PREFIX = "cell:";
const BASE_WORD = "base";

/**
 * The id of a cell of a system component's board, from the place of the look it shows (B6):
 * `cell:variant=outline:hover`, `cell:base:base` for the base itself.
 */
export const cellId = ({ state, variant }: LookPlace) =>
  `${CELL_PREFIX}${variant ? `${variant.axis}=${variant.member}` : BASE_WORD}:${state ?? BASE_WORD}`;

/** The place of the look a cell shows; null for any other node. */
export const placeOfCell = (nodeId: string): LookPlace | null => {
  if (!nodeId.startsWith(CELL_PREFIX)) {
    return null;
  }
  const rest = nodeId.slice(CELL_PREFIX.length);
  const at = rest.lastIndexOf(":");
  const member = rest.slice(0, at);
  const state = rest.slice(at + 1);
  const eq = member.indexOf("=");
  const known = COMPONENT_STATES.find((s) => s === state) ?? null;
  if (at < 0 || (state !== BASE_WORD && known === null)) {
    return null;
  }
  return {
    state: known,
    variant:
      eq < 0
        ? null
        : { axis: member.slice(0, eq), member: member.slice(eq + 1) },
  };
};

/** A state's name over its column: the base is what an instance shows by default. */
const stateTitle = (state: ComponentState | null) =>
  state === null ? "Default" : `${state[0]?.toUpperCase()}${state.slice(1)}`;

/** The component in one place of its look: its example, given the member and pinned in the state. */
const cellOf = (
  meta: ComponentMeta | undefined,
  name: string,
  place: LookPlace,
  next: ReturnType<typeof makeIdGenerator>
): DesignNode => {
  const { state, variant } = place;
  const example: DesignNode = meta
    ? exampleOf(meta, next)
    : {
        component: name,
        from: SYSTEM_FROM,
        id: next("instance"),
        text: name,
        type: "instance",
      };
  const props = {
    ...(example.type === "instance" ? example.props : undefined),
    ...(variant && { [variant.axis]: variant.member }),
    ...(state && { [STATE_ATTRIBUTE]: state }),
    ...(state === "disabled" && { disabled: true }),
  };
  return {
    align: "center",
    children: [
      {
        ...example,
        ...(Object.keys(props).length > 0 && { props }),
      } as DesignNode,
    ],
    crossAlign: "center",
    // Named for what it stands for (B6): a click on it picks that place of the look.
    id: cellId(place),
    padding: 6,
    radius: 6,
    type: "row",
  };
};

const GRID = "data-ed-node";

/**
 * The matrix's stylesheet: a grid of a column for the members' names and one a state, so that a
 * state's cells line up under its name whatever each draws. A document lays out rows and
 * columns only; a grid is the one thing written here (as Motion's animation is, B12).
 */
const gridCss = (id: string, columns: number) =>
  [
    `[${GRID}="${id}"] { display: grid !important; grid-template-columns: max-content repeat(${columns}, max-content); align-items: center; justify-items: center; column-gap: 8px; row-gap: 4px; }`,
    `[${GRID}="${id}"] > [${GRID}^="member:"] { justify-self: start; }`,
  ].join("\n");

/**
 * A system component's boards: its matrix, a row a member of the axis its states are set in (or
 * its first), a column for its default and each state it is drawn in, the members and the states
 * named; then a board for each other axis, its members side by side under their names, each in
 * its default state. A component without an axis is one row of states.
 */
export const systemComponentBoards = (
  file: SystemComponentFile,
  meta: ComponentMeta | undefined
): Board[] => {
  const next = makeIdGenerator();
  const axes = axesOf(file, meta);
  const axis = rowAxisOf(file, axes, undefined);
  const members = axis ? (axes[axis] ?? []) : [];
  const states: (ComponentState | null)[] = [null, ...drawnStates(file)];
  const rows = members.length > 0 ? members : [null];
  const grid: DesignNode[] = [
    label("corner", "", 11),
    ...states.map((s) =>
      label(`state:${s ?? BASE_WORD}`, stateTitle(s), 11, { weight: 500 })
    ),
    ...rows.flatMap((member) => [
      label(`member:${member ?? BASE_WORD}`, member ?? "", 11),
      ...states.map((state) =>
        cellOf(
          meta,
          file.name,
          {
            state,
            variant: axis && member ? { axis, member } : null,
          },
          next
        )
      ),
    ]),
  ];
  const matrix: Board = {
    css: gridCss("matrix", states.length),
    name: "matrix",
    root: sheet(
      "sheet",
      [{ children: grid, id: "matrix", type: "column" }],
      "hug"
    ),
    title: axis ? `${axis} × state` : "state",
  };
  const others = Object.keys(axes).filter((a) => a !== axis);
  return [
    matrix,
    ...others.map(
      (other): Board => ({
        name: `axis-${other}`,
        root: sheet(
          "sheet",
          [
            {
              children: (axes[other] ?? []).map(
                (member): DesignNode => ({
                  children: [
                    cellOf(
                      meta,
                      file.name,
                      { state: null, variant: { axis: other, member } },
                      next
                    ),
                    label(`member:${other}=${member}`, member, 11),
                  ],
                  crossAlign: "center",
                  gap: 4,
                  id: `members:${other}=${member}`,
                  type: "column",
                })
              ),
              crossAlign: "end",
              gap: 24,
              id: `axis:${other}`,
              type: "row",
            },
          ],
          "hug"
        ),
        title: other,
      })
    ),
  ];
};

// ---- An app component's board ----

/** A variant of an app component as its board's name says it: `tone=featured`. */
export interface AppVariant {
  readonly member: string;
  readonly property: string;
}

/** The board showing the component with no choice set: one without choices has only this one. */
export const APP_DEFAULT_BOARD = "component";

/** The variants an app component is drawn in, a member of each choice, in the properties' order. */
export const appVariantsOf = (file: AppComponentFile): AppVariant[] =>
  file.properties.flatMap((p) =>
    p.kind === "choice"
      ? (p.members ?? []).map((member) => ({ member, property: p.name }))
      : []
  );

/** The board a variant is drawn on; `APP_DEFAULT_BOARD` for none. */
export const appBoardName = (variant: AppVariant | null) =>
  variant ? `${variant.property}=${variant.member}` : APP_DEFAULT_BOARD;

/** The variant a board of an app component draws; null for the component with no choice set. */
export const appVariantOfBoard = (name: string): AppVariant | null => {
  const eq = name.indexOf("=");
  return eq < 0
    ? null
    : { member: name.slice(eq + 1), property: name.slice(0, eq) };
};

/** The instance a board of an app component draws, which a double-click edits in place. */
export const APP_INSTANCE = "instance";

/**
 * How wide an app component's sheet is: its tree's width and the margins around it, a page's
 * when it fills what holds it, else as wide as it draws, but never so narrow that an empty
 * component cannot be found.
 */
const appSheetWidth = (tree: DesignNode): number | "hug" => {
  const { width } = tree as { width?: unknown };
  if (typeof width === "number") {
    return width + 48;
  }
  return width === "fill" ? BOARD_PAGE_WIDTH : "hug";
};

/**
 * What a board of an app component edits in place: its instance, given the variant's member, and
 * where the edits land, the variant's member, or the component's own fields for its choice's
 * default member and for none.
 */
export const appInPlace = (
  file: AppComponentFile,
  variant: AppVariant | null
): NonNullable<Board["inPlace"]> => {
  const own =
    variant !== null &&
    file.properties.find((p) => p.name === variant.property)?.default ===
      variant.member;
  return {
    instance: {
      component: file.name,
      from: APP_FROM,
      id: APP_INSTANCE,
      ...(variant && { props: { [variant.property]: variant.member } }),
      type: "instance",
    },
    variant: own ? null : variant,
  };
};

/**
 * An app component's boards (ADR 0045): a board a member of each choice, side by side, its
 * instance given that member (`tone=featured`); one with no choice is drawn once, as every
 * instance that sets nothing draws it.
 */
export const appComponentBoards = (file: AppComponentFile): Board[] => {
  const variants = appVariantsOf(file);
  return (variants.length > 0 ? variants : [null]).map((variant): Board => {
    const inPlace = appInPlace(file, variant);
    return {
      inPlace,
      name: appBoardName(variant),
      root: {
        ...sheet("sheet", [inPlace.instance], appSheetWidth(file.tree)),
        minWidth: 240,
      },
      title: variant ? appBoardName(variant) : "as an instance",
    };
  });
};

/**
 * The boards of an item of the Library: the Overview's, a system component's (in its file, or
 * its default look when the project has none) or an app component's. None for a component the
 * Library does not have.
 */
export const libraryBoards = (
  item: string,
  catalogue: readonly ComponentMeta[],
  fileOf: (name: string) => ComponentFile | undefined,
  /** How wide the Overview drew the app components that hug what they hold. */
  drawn: Readonly<Record<string, number>> = {}
): Boards => {
  if (item === OVERVIEW) {
    return {
      boards: [overviewBoard(catalogue, fileOf, drawn)],
      direction: "column",
    };
  }
  const file = fileOf(item);
  if (!file) {
    return { boards: [], direction: "column" };
  }
  if (file.origin === "app") {
    return { boards: appComponentBoards(file), direction: "row" };
  }
  const meta = catalogue.find((c) => c.name === item);
  return {
    boards: systemComponentBoards(file, meta),
    direction: "column",
  };
};
