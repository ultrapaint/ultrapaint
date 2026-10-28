/**
 * Draws design documents in the editor's frames, with the editor's own React (ADR 0040): a page's
 * nodes as elements, an instance as one of the editor's primitives (on Base UI) or as a draft's
 * tree. Nothing of the repository's is loaded or run.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import type { InstanceDrawn } from "@ultrapaint/contracts/preview";
import { DRAFT_FROM, PRIMITIVES_FROM } from "@ultrapaint/contracts/spec-names";
import type { ComponentSpec } from "@ultrapaint/contracts/specs";
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
import {
  COMPONENT_ATTRIBUTE,
  specCss,
  VARIANT_ATTRIBUTE,
  variantAttributeOf,
} from "@ultrapaint/design-document/spec";
import { childrenOf } from "@ultrapaint/design-document/tree";
import {
  type Mounted,
  NODE_ATTRIBUTE,
  type RenderRequest,
  type RenderSetup,
  type RenderToCanvas,
} from "@ultrapaint/framework-api/browser";
import { primitiveOf, slotFor } from "@ultrapaint/primitives/catalogue";
import { PRIMITIVE_COMPONENTS } from "@ultrapaint/primitives/components";
import {
  type PrimitiveFrame,
  PrimitiveFrameProvider,
} from "@ultrapaint/primitives/frame";
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

/** The attribute the nodes of a draft's tree are marked with: not the page's, so not selectable. */
const DRAFT_NODE_ATTRIBUTE = "data-ed-draft-node";

/** What every node of one render needs, handed down without threading it through props. */
interface Scope {
  readonly assetUrl: (src: string) => string;
  /** The trees of the draft components (ADR 0029), by component name. */
  readonly drafts: ReadonlyMap<string, DesignNode>;
  readonly navigate: (route: string) => void;
  /**
   * What a node's id is written in: the page's attribute, or, inside a draft's tree, one the
   * editor does not read, so only the draft's instance can be selected.
   */
  readonly nodeAttribute: string;
  /** Tells the editor how an instance lays its children out, once it is drawn. */
  readonly report: (nodeId: string, drawn: InstanceDrawn) => void;
  readonly styles: Omit<StyleContext, "parent">;
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
 * before ADR 0040, or a primitive's name misspelt. It keeps the node's marks and its box.
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

/** What a draft's instance gives the root of the draft's tree: its id, its marks, its box. */
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
  /** Set on a draft's root, which stands for the instance on the page. */
  own?: RootOverride | undefined;
  parent: ParentLayout;
}): ReactNode => {
  const scope = useContext(ScopeContext) as Scope;
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

/** A tree with its first text node's text replaced. */
const withFirstText = (tree: DesignNode, text: string): DesignNode => {
  let done = false;
  const visit = (node: DesignNode): DesignNode => {
    if (done) {
      return node;
    }
    if (node.type === "text") {
      done = true;
      return { ...node, text };
    }
    if ("children" in node && node.children) {
      return {
        ...node,
        children: node.children.map(visit),
      } as DesignNode;
    }
    return node;
  };
  return visit(tree);
};

/** The marks every instance's element carries: its id, and what a spec finds it by. */
const marksOf = (scope: Scope, node: InstanceNode) => ({
  [scope.nodeAttribute]: node.id,
  [COMPONENT_ATTRIBUTE]: node.component,
  [VARIANT_ATTRIBUTE]: variantAttributeOf(node.props),
  "data-ed-instance": node.component,
});

/**
 * A draft component's instance (ADR 0029): the draft's tree drawn in its place, its root carrying
 * the instance's id, marks and box, so the instance is what is selected, and the spec's styles
 * reach it as they reach a primitive. The instance's text replaces the tree's first text.
 */
const DraftView = ({
  node,
  style,
}: {
  node: InstanceNode;
  style: Style;
}): ReactNode => {
  const scope = useContext(ScopeContext) as Scope;
  const tree = scope.drafts.get(node.component);
  const marks = marksOf(scope, node);
  if (!tree) {
    return createElement(Missing, {
      ...marks,
      style,
      text: `${node.component} is not a draft component`,
    });
  }
  const filled =
    node.text === undefined ? tree : withFirstText(tree, node.text);
  return createElement(
    ScopeContext.Provider,
    { value: { ...scope, nodeAttribute: DRAFT_NODE_ATTRIBUTE } },
    createElement(NodeView, {
      node: filled,
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
 * One of the editor's own primitives (ADR 0040). It takes its instance's props, and its children
 * by the slot each names: the ones that name none are its children, the others go in `slots`,
 * each laid out as its slot lays out. The node's id, marks and box go on the element the
 * primitive draws as the instance; how its children are laid out is the catalogue's, and the
 * editor is told it.
 */
const PrimitiveView = ({
  node,
  style,
}: {
  node: InstanceNode;
  style: Style;
}): ReactNode => {
  const scope = useContext(ScopeContext) as Scope;
  const Primitive = PRIMITIVE_COMPONENTS[node.component];
  const meta = primitiveOf(node.component);
  const fallback = meta && slotFor(meta, undefined);
  const layout = fallback?.layout ?? "block";
  useLayoutEffect(() => {
    scope.report(node.id, { layout, wrapped: false });
  }, [scope, node.id, layout]);
  const marks = marksOf(scope, node);
  if (!(Primitive && meta)) {
    return createElement(Missing, {
      ...marks,
      style,
      text: `${node.component} is not one of the primitives`,
    });
  }
  const bySlot = new Map<string, ReactNode[]>();
  const children = childrenOf(node);
  for (const child of children) {
    const slot = slotFor(meta, child.slot) ?? fallback;
    if (!slot) {
      continue;
    }
    const drawn = createElement(NodeView, {
      key: child.id,
      node: child,
      parent: slot.layout ?? "block",
    });
    bySlot.set(slot.name, [...(bySlot.get(slot.name) ?? []), drawn]);
  }
  const slots: Record<string, ReactNode> = {};
  let content: ReactNode =
    children.length === 0 && node.text !== undefined ? node.text : undefined;
  for (const [name, drawn] of bySlot) {
    if (name === fallback?.name) {
      content = drawn;
    } else {
      slots[name] = drawn;
    }
  }
  return createElement(
    Boundary,
    { label: node.component, nodeId: node.id, resetKeys: [node] },
    createElement(
      Primitive,
      {
        ...(node.props ?? {}),
        ...marks,
        ...(node.link && { onClickCapture: onLink(scope, node.link) }),
        slots,
        ...(setsAnything(style) && { style }),
      },
      content
    )
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
  if (node.from === DRAFT_FROM) {
    return createElement(DraftView, { node, style });
  }
  if (node.from === PRIMITIVES_FROM) {
    return createElement(PrimitiveView, { node, style });
  }
  return createElement(Missing, {
    ...marksOf(scope, node),
    style,
    text: `${node.component} is a component of the repository's: the canvas draws primitives`,
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

/** The frame the primitives draw in, running or designed as the frame is (ADR 0040). */
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
  const value = useMemo<PrimitiveFrame>(
    () => ({ container: frame.container, host: frame.host, interactive }),
    [frame, interactive]
  );
  return createElement(PrimitiveFrameProvider, { frame: value }, children);
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
  let specs: readonly ComponentSpec[] | undefined;
  let drafts: ReadonlyMap<string, DesignNode> = new Map();
  const onError = (error: Error) =>
    setup.reportError({ message: error.message, stack: error.stack });

  // How instances lay out their children goes to the editor once a frame, and only what changed.
  const told = new Map<string, InstanceDrawn>();
  let unsent: Record<string, InstanceDrawn> = {};
  let sendScheduled = false;
  const sendInstances = () => {
    sendScheduled = false;
    const drawn = unsent;
    unsent = {};
    setup.reportInstances(drawn);
  };
  const report = (nodeId: string, drawn: InstanceDrawn) => {
    const before = told.get(nodeId);
    if (before?.layout === drawn.layout && before.wrapped === drawn.wrapped) {
      return;
    }
    told.set(nodeId, drawn);
    unsent[nodeId] = drawn;
    if (!sendScheduled) {
      sendScheduled = true;
      requestAnimationFrame(sendInstances);
    }
  };

  let first = true;
  /** What the request changes of the design system, the specs and the design's stylesheet. */
  let tokenCss: string | undefined;
  const restyle = (request: RenderRequest) => {
    const restyled =
      request.designSystem !== designSystem ||
      request.specs !== specs ||
      request.styles !== tokenCss;
    if (request.designSystem !== designSystem) {
      ({ designSystem } = request);
      styles = makeStyleContext(designSystem);
    }
    if (request.specs !== specs) {
      ({ specs } = request);
      drafts = new Map(
        (specs ?? []).flatMap((spec) =>
          spec.draft ? [[spec.component, spec.draft] as const] : []
        )
      );
    }
    tokenCss = request.styles;
    // The design's own stylesheet (ADR 0028, 0029): every token's value and the component specs,
    // which the core puts after every other sheet of the frames.
    if (restyled) {
      setup.setDesignCss(
        [tokenCss ?? "", specCss(specs ?? [], styles)]
          .filter(Boolean)
          .join("\n\n")
      );
    }
  };

  const draw = (request: RenderRequest) => {
    restyle(request);
    const scope: Scope = {
      assetUrl: setup.assetUrl,
      drafts,
      navigate: setup.navigate,
      nodeAttribute: NODE_ATTRIBUTE,
      report,
      styles,
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
