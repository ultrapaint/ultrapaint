/**
 * Draws design documents in the editor's frames, with the editor's own React (ADRs 0040, 0041): a
 * page's nodes as elements, an instance as one of the editor's system components (on Base UI) or
 * as an app component's tree. Nothing of the repository's is loaded or run.
 */

import { type Catalogue, metaOf } from "@ultrapaint/contracts/catalogue";
import {
  APP_FROM,
  type AppComponentFile,
  appComponentsIn,
  type ComponentFile,
  type ItemTemplate,
  SYSTEM_FROM,
  type SystemComponentFile,
  systemComponentsIn,
} from "@ultrapaint/contracts/components";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import { expandAppInstance } from "@ultrapaint/design-document/app-components";
import {
  COMPONENT_ATTRIBUTE,
  VARIANT_ATTRIBUTE,
  variantAttributeOf,
} from "@ultrapaint/design-document/component-look";
import {
  layoutOf,
  makeStyleContext,
  maskOf,
  nodeStyle,
  type ParentLayout,
  type Style,
  type StyleContext,
  tagOf,
} from "@ultrapaint/design-document/css";
import { fillSlots, slotLayoutOf } from "@ultrapaint/design-document/slots";
import { childrenOf } from "@ultrapaint/design-document/tree";
import {
  type Drawing,
  type Mounted,
  NODE_ATTRIBUTE,
  type RenderRequest,
  type RenderSetup,
  type RenderToCanvas,
} from "@ultrapaint/framework-api/browser";
import {
  catalogueOf,
  systemComponentOf,
} from "@ultrapaint/system-components/catalogue";
import { SYSTEM_COMPONENT_VIEWS } from "@ultrapaint/system-components/components";
import {
  type ComponentFrame,
  ComponentFrameProvider,
} from "@ultrapaint/system-components/frame";
import {
  Component,
  createContext,
  createElement,
  type ReactNode,
  startTransition,
  useContext,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";

const ERROR_STYLE = {
  background: "#fef2f2",
  border: "1px dashed #f87171",
  color: "#b91c1c",
  fontFamily:
    'ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: 11,
  padding: 8,
  whiteSpace: "pre-wrap",
} as const;

const MISSING_STYLE = {
  alignItems: "center",
  background: "#f4f4f5",
  border: "1px dashed #a1a1aa",
  color: "#71717a",
  display: "inline-flex",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  fontSize: 12,
  minHeight: 32,
  padding: "4px 8px",
} as const;

const MESSAGE_STYLE = {
  alignItems: "center",
  color: "#71717a",
  display: "flex",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  fontSize: 13,
  justifyContent: "center",
  minHeight: "100cqh",
} as const;

/**
 * The attribute the nodes of an app component's tree are marked with: not the page's, so only
 * the instance is selected.
 */
export const APP_NODE_ATTRIBUTE = "data-ed-app-node";
/**
 * What a page's nodes are marked with while an app component's instance is edited in place: not
 * the page's attribute, so only the component's nodes can be selected.
 */
const OUTSIDE_ATTRIBUTE = "data-ed-outside";
/** The page around an instance edited in place, dimmed. */
const DIMMED = "rgb(9 9 11 / 0.5)";

/** What every node of one render needs, handed down without threading it through props. */
interface Scope {
  /** The app components (ADR 0041), by name. */
  readonly apps: ReadonlyMap<string, AppComponentFile>;
  readonly assetUrl: (src: string) => string;
  /** What a design can place (ADR 0042): how each slot of an instance lays out what it holds. */
  readonly catalogue: Catalogue;
  /** The app components whose tree is being drawn, outermost first: one inside itself is refused. */
  readonly drawing: readonly string[];
  /** The page's nodes among an app component's tree: an instance's children in its slots. */
  readonly filled?: ReadonlySet<string> | undefined;
  /** The instance edited in place, with the props it is drawn with, when one is (ADR 0041). */
  readonly isolating?: RenderRequest["isolate"];
  readonly navigate: (route: string) => void;
  /**
   * What a node's id is written in: the page's attribute, or, inside an app component's tree,
   * one the editor does not read, so only the instance can be selected.
   */
  readonly nodeAttribute: string;
  /** What the page's own nodes are written in: the page's attribute, or, editing in place, not. */
  readonly pageAttribute: string;
  readonly styles: Omit<StyleContext, "parent">;
  /** The looks of the system components the project owns (ADR 0041), by name. */
  readonly systems: ReadonlyMap<string, SystemComponentFile>;
}

const ScopeContext = createContext<Scope | null>(null);

interface BoundaryProps {
  children?: ReactNode;
  label: string;
  /** The node the error box stands for, so it can still be pointed at and measured. */
  nodeId?: string;
  onError?: (error: Error) => void;
  /** What is drawn: when any of it changes, an error is forgotten and the children drawn again. */
  resetKeys: readonly unknown[];
}

interface BoundaryState {
  readonly error: Error | null;
  readonly resetKeys: readonly unknown[];
}

const sameKeys = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((key, i) => Object.is(key, b[i]));

/**
 * Keeps one part that throws from taking the rest of the page with it. The error stays until what
 * is drawn changes, and is then tried again.
 */
class Boundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = {
    error: null,
    resetKeys: this.props.resetKeys,
  };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: BoundaryState
  ): Partial<BoundaryState> | null {
    if (sameKeys(props.resetKeys, state.resetKeys)) {
      return null;
    }
    return { error: null, resetKeys: props.resetKeys };
  }

  override componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  override render() {
    const { error } = this.state;
    return error
      ? createElement(
          "div",
          {
            ...(this.props.nodeId !== undefined && {
              [NODE_ATTRIBUTE]: this.props.nodeId,
            }),
            style: ERROR_STYLE,
          },
          `${this.props.label}: ${error.message}`
        )
      : this.props.children;
  }
}

const Message = ({ text }: { text: string }) =>
  createElement("div", { style: MESSAGE_STYLE }, text);

/**
 * Stands in for an instance of nothing the editor has: a component of the repository's from
 * before ADR 0040, or a system component's name misspelt. It keeps the node's marks and its box.
 */
const Missing = ({
  onClickCapture,
  style,
  text,
  ...rest
}: {
  onClickCapture?: unknown;
  style?: Style;
  text: string;
  [prop: string]: unknown;
}) =>
  createElement(
    "span",
    {
      ...Object.fromEntries(
        Object.entries(rest).filter(([name]) => name.startsWith("data-ed-"))
      ),
      onClickCapture,
      style: { ...MISSING_STYLE, ...style },
    },
    text
  );

/** Whether the style sets anything at all beyond the border-box every node gets. */
const setsAnything = (style: Style) =>
  Object.keys(style).some((key) => key !== "boxSizing");

const onLink = (scope: Scope, link: string | undefined) =>
  link
    ? (event: { preventDefault: () => void; stopPropagation: () => void }) => {
        event.preventDefault();
        event.stopPropagation();
        scope.navigate(link);
      }
    : undefined;

/** What an app component's instance gives the root of its tree: its id, its marks, its box. */
interface RootOverride {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly style: Style;
}

const NodeView = ({
  node,
  own,
  parent,
}: {
  node: DesignNode;
  /** Set on an app component's root, which stands for the instance on the page. */
  own?: RootOverride | undefined;
  parent: ParentLayout;
}): ReactNode => {
  const scope = useContext(ScopeContext) as Scope;
  if (scope.filled?.has(node.id)) {
    // A node of the page's in an app component's slot: selectable as the page's again.
    return createElement(
      ScopeContext.Provider,
      {
        value: {
          ...scope,
          filled: undefined,
          nodeAttribute: scope.pageAttribute,
        },
      },
      createElement(NodeView, { node, parent })
    );
  }
  const drawn = nodeStyle(node, { ...scope.styles, parent });
  const style = own ? { ...drawn, ...own.style } : drawn;
  const common: Record<string, unknown> = own
    ? { ...own.attributes, style }
    : {
        [scope.nodeAttribute]: node.id,
        onClick: onLink(scope, node.link),
        style,
      };
  if (node.type === "instance") {
    // A node that becomes another component starts over.
    return createElement(InstanceView, {
      key: `${node.from}#${node.component}`,
      node,
      style,
    });
  }
  if (node.type === "text") {
    return createElement(tagOf(node), common, node.text);
  }
  if (node.type === "image" && node.tint !== undefined) {
    // Its shape, filled with the tint: the file is drawn as a mask.
    return createElement("span", {
      ...common,
      "aria-label": node.alt ?? "",
      role: "img",
      style: { ...style, ...maskOf(scope.assetUrl(node.src)) },
    });
  }
  if (node.type === "image") {
    return createElement("img", {
      ...common,
      alt: node.alt ?? "",
      draggable: false,
      src: scope.assetUrl(node.src),
    });
  }
  const layout = layoutOf(node);
  return createElement(
    "div",
    common,
    childrenOf(node).map((child) =>
      createElement(NodeView, { key: child.id, node: child, parent: layout })
    )
  );
};

/** The marks every instance's element carries: its id, and what a look finds it by. */
const marksOf = (scope: Scope, node: InstanceNode) => ({
  [scope.nodeAttribute]: node.id,
  [COMPONENT_ATTRIBUTE]: node.component,
  [VARIANT_ATTRIBUTE]: variantAttributeOf(node.props),
  "data-ed-instance": node.component,
});

/**
 * An app component's instance (ADR 0041): its tree drawn in its place, with the instance's
 * property values, its choices' overrides and its children in their slots (`expandAppInstance`).
 * The root carries the instance's id, marks and box, so the instance is what is selected; the
 * tree's own nodes are not the page's, and an app component drawn inside itself is refused.
 */
const AppView = ({
  node,
  style,
}: {
  node: InstanceNode;
  style: Style;
}): ReactNode => {
  const scope = useContext(ScopeContext) as Scope;
  const file = scope.apps.get(node.component);
  const marks = marksOf(scope, node);
  if (!file) {
    return createElement(Missing, {
      ...marks,
      style,
      text: `${node.component} is not an app component`,
    });
  }
  if (scope.drawing.includes(node.component)) {
    return createElement(Missing, {
      ...marks,
      style,
      text: `${node.component} is drawn inside itself`,
    });
  }
  const editing = scope.isolating?.instance === node.id;
  // Edited in place, it draws the component's own values, at the variant being edited.
  const { filled, tree } = expandAppInstance(
    file,
    editing ? { ...node, props: scope.isolating?.props ?? {} } : node
  );
  if (editing) {
    return createElement(IsolatedView, { file, filled, node, style, tree });
  }
  return createElement(
    ScopeContext.Provider,
    {
      value: {
        ...scope,
        drawing: [...scope.drawing, node.component],
        filled,
        nodeAttribute: APP_NODE_ATTRIBUTE,
      },
    },
    createElement(NodeView, {
      node: tree,
      own: {
        attributes: {
          ...marks,
          ...(node.link && { onClickCapture: onLink(scope, node.link) }),
        },
        style: Object.fromEntries(
          Object.entries(style).filter(([key]) => key !== "boxSizing")
        ),
      },
      parent: "free",
    })
  );
};

/**
 * An app component's instance edited in place (ADR 0041): its tree's nodes are the ones the editor
 * selects, by the component's ids, the root standing where the instance is, and the page around it
 * is dimmed, its nodes, those in the instance's slots included, not selectable.
 */
const IsolatedView = ({
  file,
  filled,
  node,
  style,
  tree,
}: {
  file: AppComponentFile;
  filled: ReadonlySet<string>;
  node: InstanceNode;
  style: Style;
  tree: DesignNode;
}): ReactNode => {
  const scope = useContext(ScopeContext) as Scope;
  const own = Object.fromEntries(
    Object.entries(style).filter(([key]) => key !== "boxSizing")
  );
  return createElement(
    ScopeContext.Provider,
    {
      value: {
        ...scope,
        drawing: [...scope.drawing, file.name],
        filled,
        nodeAttribute: NODE_ATTRIBUTE,
      },
    },
    createElement(NodeView, {
      node: tree,
      own: {
        attributes: {
          [NODE_ATTRIBUTE]: tree.id,
          [COMPONENT_ATTRIBUTE]: node.component,
          [VARIANT_ATTRIBUTE]: variantAttributeOf(node.props),
          "data-ed-instance": node.component,
          "data-ed-isolated": "",
        },
        style: {
          ...own,
          outline: `100vmax solid ${DIMMED}`,
          position: own.position ?? "relative",
          zIndex: "2147483000",
        },
      },
      parent: "free",
    })
  );
};

/**
 * One of the editor's own system components (ADR 0040). It takes its instance's props, and its children
 * by the slot each names: the ones that name none are its children, the others go in `slots`,
 * each laid out as its slot lays out (`slotLayoutOf`). The node's id, marks and box go on the
 * element the system component draws as the instance.
 */
const SystemView = ({
  node,
  style,
}: {
  node: InstanceNode;
  style: Style;
}): ReactNode => {
  const scope = useContext(ScopeContext) as Scope;
  const View = SYSTEM_COMPONENT_VIEWS[node.component];
  const meta = systemComponentOf(node.component);
  const marks = marksOf(scope, node);
  const entry = metaOf(scope.catalogue, node);
  if (!(View && meta && entry)) {
    return createElement(Missing, {
      ...marks,
      style,
      text: `${node.component} is not one of the system components`,
    });
  }
  const look = scope.systems.get(node.component);
  // Each slot holds what fills it (`fillSlots`); the look's content is not the page's.
  const slots: Record<string, ReactNode> = {};
  let content: ReactNode =
    childrenOf(node).length === 0 && node.text !== undefined
      ? node.text
      : undefined;
  for (const [name, fill] of fillSlots(node, entry.slots, look?.content)) {
    const parent = slotLayoutOf(node, name, scope.catalogue) ?? "block";
    const drawn = fill.nodes.map((child) =>
      createElement(NodeView, { key: child.id, node: child, parent })
    );
    const held = fill.given
      ? drawn
      : createElement(
          ScopeContext.Provider,
          {
            key: `content:${name}`,
            value: { ...scope, nodeAttribute: APP_NODE_ATTRIBUTE },
          },
          drawn
        );
    if (entry.slots.find((s) => s.name === name)?.holds === "default") {
      content = held;
    } else {
      slots[name] = held;
    }
  }
  return createElement(
    Boundary,
    { label: node.component, nodeId: node.id, resetKeys: [node] },
    createElement(
      View,
      {
        ...(node.props ?? {}),
        ...marks,
        ...(node.link && { onClickCapture: onLink(scope, node.link) }),
        slots,
        ...(setsAnything(style) && { style }),
        ...(meta.templatedItems &&
          look?.item && { drawItem: itemDrawer(scope, look.item) }),
      },
      content
    )
  );
};

/**
 * What draws an item of a Select or a Menu from a look's template (ADR 0041): its tree, the
 * item's label in the text node `label` names and its picture in the image `image` names. The
 * template's nodes are the look's, not the page's.
 */
const itemDrawer =
  (scope: Scope, template: ItemTemplate) =>
  (item: { readonly image?: string | undefined; readonly label: string }) => {
    const bind = (n: DesignNode): DesignNode => {
      if (n.id === template.label && n.type === "text") {
        return { ...n, text: item.label };
      }
      if (n.id === template.image && n.type === "image") {
        return item.image ? { ...n, src: item.image } : { ...n, hidden: true };
      }
      return "children" in n && n.children
        ? ({ ...n, children: n.children.map(bind) } as DesignNode)
        : n;
    };
    return createElement(
      ScopeContext.Provider,
      { value: { ...scope, nodeAttribute: APP_NODE_ATTRIBUTE } },
      createElement(NodeView, { node: bind(template.tree), parent: "row" })
    );
  };

const InstanceView = ({
  node,
  style,
}: {
  node: InstanceNode;
  style: Style;
}): ReactNode => {
  const scope = useContext(ScopeContext) as Scope;
  if (node.from === APP_FROM) {
    return createElement(AppView, { node, style });
  }
  if (node.from === SYSTEM_FROM) {
    return createElement(SystemView, { node, style });
  }
  return createElement(Missing, {
    ...marksOf(scope, node),
    style,
    text: `${node.component} is a component of the repository's: the canvas draws system components`,
  });
};

/** Tells the core once a render is on the screen, so rects are measured on what is there. */
const Rendered = ({
  onRendered,
  renderId,
}: {
  onRendered: (id: number) => void;
  renderId: number;
}) => {
  useLayoutEffect(() => {
    onRendered(renderId);
  }, [onRendered, renderId]);
  return null;
};

/** The frame the system components draw in, running or designed as the frame is (ADR 0040). */
const FrameScope = ({
  children,
  frame,
}: {
  children?: ReactNode;
  frame: RenderSetup["frame"];
}) => {
  const interactive = useSyncExternalStore(
    frame.onInteractive,
    frame.interactive
  );
  const value = useMemo<ComponentFrame>(
    () => ({ container: frame.container, host: frame.host, interactive }),
    [frame, interactive]
  );
  return createElement(ComponentFrameProvider, { frame: value }, children);
};

export const renderToCanvas: RenderToCanvas = (setup: RenderSetup, canvas) => {
  const root = createRoot(canvas, {
    onUncaughtError: (error) =>
      setup.reportError({
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }),
  });
  let designSystem: DesignSystem | null = null;
  let styles = makeStyleContext(null);
  let components: readonly ComponentFile[] = [];
  let apps: ReadonlyMap<string, AppComponentFile> = new Map();
  let catalogue = catalogueOf([]);
  let systems: ReadonlyMap<string, SystemComponentFile> = new Map();
  const onError = (error: Error) =>
    setup.reportError({ message: error.message, stack: error.stack });

  let first = true;
  /** What the drawing changes of the design system and the components. */
  const restyle = (drawing: Drawing) => {
    if (drawing.designSystem !== designSystem) {
      ({ designSystem } = drawing);
      styles = makeStyleContext(designSystem);
    }
    if (drawing.components !== components) {
      ({ components } = drawing);
      catalogue = catalogueOf(components);
      apps = new Map(appComponentsIn(components).map((c) => [c.name, c]));
      systems = new Map(systemComponentsIn(components).map((c) => [c.name, c]));
    }
  };

  const draw = (request: Drawing) => {
    restyle(request);
    const pageAttribute =
      request.isolate === undefined ? NODE_ATTRIBUTE : OUTSIDE_ATTRIBUTE;
    const scope: Scope = {
      apps,
      assetUrl: setup.assetUrl,
      catalogue,
      drawing: [],
      isolating: request.isolate,
      navigate: setup.navigate,
      nodeAttribute: pageAttribute,
      pageAttribute,
      styles,
      systems,
    };
    const { root: node } = request;
    let body: ReactNode;
    if (request.message !== undefined || node === null) {
      body = createElement(Message, {
        text: request.message ?? "Nothing to show",
      });
    } else if (request.mode === "page" && node.type === "page") {
      body = createElement(NodeView, {
        node: {
          ...node,
          minHeight: node.minHeight ?? setup.pageHeight,
        },
        parent: "free",
      });
    } else {
      body = createElement(NodeView, { node, parent: "free" });
    }
    const tree = createElement(
      FrameScope,
      { frame: setup.frame },
      createElement(
        ScopeContext.Provider,
        { value: scope },
        createElement(
          Boundary,
          {
            key: "page",
            label: "The page",
            onError,
            resetKeys: [request],
          },
          body
        ),
        createElement(Rendered, {
          onRendered: setup.onRendered,
          renderId: request.renderId,
        })
      )
    );
    if (first) {
      first = false;
      root.render(tree);
    } else {
      startTransition(() => root.render(tree));
    }
  };

  const mounted: Mounted = {
    render: draw,
    unmount: () => root.unmount(),
  };
  return mounted;
};
