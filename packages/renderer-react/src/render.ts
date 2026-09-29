/**
 * Draws design documents with the target repository's own React. This module is bundled with
 * `react` left as an import, so it is the repository's copy — the one its design system uses —
 * that renders, and an instance is the real component, imported through the generated registry.
 *
 * The providers are mounted once and stay mounted: a new document is drawn under them, so what
 * a provider holds survives an edit and a navigation, as it does in the real application.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import type { InstanceDrawn } from "@ultrapaint/contracts/preview";
import {
  layoutOf,
  makeStyleContext,
  nodeStyle,
  type ParentLayout,
  type Style,
  type StyleContext,
  tagOf,
} from "@ultrapaint/design-document/css";
import { childrenOf } from "@ultrapaint/design-document/tree";
import type {
  ComponentRegistry,
  Mounted,
  RenderRequest,
  RenderSetup,
  RenderToCanvas,
} from "@ultrapaint/framework-api/browser";
import {
  Component,
  type ComponentType,
  createContext,
  createElement,
  Fragment,
  lazy,
  type ReactNode,
  Suspense,
  startTransition,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";

const NODE_ATTRIBUTE = "data-ed-node";

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
  minHeight: "100vh",
} as const;

/** What every node of one render needs, handed down without threading it through props. */
interface Scope {
  readonly assetUrl: (src: string) => string;
  readonly componentOf: (
    node: InstanceNode
  ) => ComponentType<Record<string, unknown>> | null;
  /** How each instance was drawn, which the instance reads and its effect writes. */
  readonly instances: InstanceStore;
  /** What earlier instances of a component taught: whether it wraps, how it lays out. */
  readonly learned: Learned;
  readonly navigate: (route: string) => void;
  readonly styles: Omit<StyleContext, "parent">;
}

const ScopeContext = createContext<Scope | null>(null);

interface BoundaryProps {
  children?: ReactNode;
  label: string;
  /** The node the error box stands for, so it can still be pointed at and measured. */
  nodeId?: string;
  onError?: (error: Error) => void;
}

/** Keeps one component that throws from taking the rest of the page with it. */
class Boundary extends Component<BoundaryProps, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
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

const PassThrough = ({ children }: { children: ReactNode }) =>
  createElement(Fragment, null, children);

const Message = ({ text }: { text: string }) =>
  createElement("div", { style: MESSAGE_STYLE }, text);

/**
 * Stands in for a component that cannot be found. It keeps what the renderer gives an instance
 * (the node's id, its box, a link's handler) and drops the component's own props.
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether the style asks for a box of its own, beyond the border-box every node gets. */
const hasBox = (style: Style) =>
  Object.keys(style).some((key) => key !== "boxSizing" && key !== "cursor");

/** Whether the style sets anything at all beyond the border-box every node gets. */
const setsAnything = (style: Style) =>
  Object.keys(style).some((key) => key !== "boxSizing");

/** How an instance's children are laid out; never `free`, which is the root of a render's. */
type ChildLayout = InstanceDrawn["layout"];

const selectorOf = (id: string) => `[${NODE_ATTRIBUTE}="${CSS.escape(id)}"]`;

/** The box an element's children are laid out in: past any `display: contents` in between. */
const containerOf = (el: Element): Element | null => {
  let parent = el.parentElement;
  while (parent && getComputedStyle(parent).display === "contents") {
    parent = parent.parentElement;
  }
  return parent;
};

/** How an element lays out its children, in the format's terms: a flexbox, or anything else. */
const layoutOfElement = (el: Element): ChildLayout => {
  const style = getComputedStyle(el);
  if (style.display !== "flex" && style.display !== "inline-flex") {
    return "block";
  }
  return style.flexDirection.startsWith("column") ? "column" : "row";
};

const onLink = (scope: Scope, link: string | undefined) =>
  link
    ? (event: { preventDefault: () => void; stopPropagation: () => void }) => {
        event.preventDefault();
        event.stopPropagation();
        scope.navigate(link);
      }
    : undefined;

const NodeView = ({
  node,
  parent,
}: {
  node: DesignNode;
  parent: ParentLayout;
}): ReactNode => {
  const scope = useContext(ScopeContext) as Scope;
  const style = nodeStyle(node, { ...scope.styles, parent });
  const common = {
    [NODE_ATTRIBUTE]: node.id,
    onClick: onLink(scope, node.link),
    style,
  };
  if (node.type === "instance") {
    // A node that becomes another component starts over: what was learned was about the old one.
    return createElement(InstanceView, {
      key: `${node.from}#${node.component}`,
      node,
      style,
    });
  }
  if (node.type === "text") {
    return createElement(tagOf(node), common, node.text);
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

/**
 * An instance is the design system's own component, and its box fields are the component's: the
 * style, the node's id and a link's handler are given to it as props, which a component that
 * passes its props on to its root element (what nearly every design system does) puts on that
 * element. Sized, padded or filled, it is the component that is, as it is in the code
 * (`className` on the component), and the component stays the direct child of its parent, which
 * its own selectors (`*:`, `has-[>…]`, `:first-child`, grid placement) count on.
 *
 * A component that keeps its props to itself is found out after the first commit, when the id is
 * nowhere in the DOM, and drawn inside a wrapper instead: one with no box of its own
 * (`display: contents`) when the node sets none, otherwise one that carries the box and stretches
 * the component across it. It is the one case where the canvas and the code differ, and the
 * editor is told.
 *
 * What the instance's children are sized against is the element that holds them: a Card that is
 * a flex column grows a child that fills its height, as it would in the application. It is read
 * off the DOM after each commit, and a change draws the children again before the frame is
 * painted.
 */
const InstanceView = ({
  node,
  style,
}: {
  node: InstanceNode;
  style: Style;
}): ReactNode => {
  const scope = useContext(ScopeContext) as Scope;
  const Resolved = scope.componentOf(node);
  const key = `${node.from}#${node.component}`;
  const { instances, learned } = scope;
  const seen = useSyncExternalStore(
    (listener) => instances.subscribe(node.id, listener),
    () => instances.get(node.id)
  );
  // What was seen of another component, or of this one before its module was reloaded, is
  // asked again; until then, what other instances of the component showed is the guess.
  const known = seen?.component === Resolved ? seen : undefined;
  const wrapped = known?.wrapped ?? learned.wraps.has(key);
  const layout = known?.layout ?? learned.layouts.get(key) ?? "block";
  const children = childrenOf(node);
  const firstChild = children[0]?.id;

  useLayoutEffect(() => {
    const own = document.querySelector(selectorOf(node.id));
    if (!(wrapped || own)) {
      // The id went nowhere: the component does not pass its props on.
      instances.set(node.id, { component: Resolved, layout, wrapped: true });
      return;
    }
    if (wrapped && own && own.childElementCount > 0) {
      // The wrapper holds what the component drew, none of it carrying the id: the component
      // keeps its props to itself whatever it is given. One that drew nothing tells nothing.
      learned.wraps.add(key);
    }
    const child =
      firstChild === undefined
        ? null
        : document.querySelector(selectorOf(firstChild));
    const container = child ? containerOf(child) : null;
    const next = container ? layoutOfElement(container) : layout;
    if (container) {
      learned.layouts.set(key, next);
    }
    instances.set(node.id, { component: Resolved, layout: next, wrapped });
  });

  const content =
    children.length > 0
      ? children.map((child) =>
          createElement(NodeView, {
            key: child.id,
            node: child,
            parent: layout,
          })
        )
      : node.text;
  const props = node.props ?? {};
  const onClickCapture = onLink(scope, node.link);
  const component = (extra: Record<string, unknown>) =>
    createElement(
      Boundary,
      { key, label: node.component, nodeId: wrapped ? undefined : node.id },
      Resolved
        ? createElement(Resolved, { ...props, ...extra }, content)
        : createElement(Missing, {
            ...extra,
            text: `${node.component} is not in ${node.from}`,
          })
    );

  if (!wrapped) {
    const own = isRecord(props.style) ? props.style : {};
    return component({
      [NODE_ATTRIBUTE]: node.id,
      "data-ed-instance": node.component,
      ...(onClickCapture && { onClickCapture }),
      ...(setsAnything(style) && { style: { ...own, ...style } }),
    });
  }
  const wrapperStyle = hasBox(style)
    ? { display: "flex", flexDirection: "column", ...style }
    : { display: "contents" };
  return createElement(
    "div",
    {
      [NODE_ATTRIBUTE]: node.id,
      "data-ed-instance": node.component,
      "data-ed-wrapper": "",
      onClickCapture,
      style: wrapperStyle,
    },
    component({})
  );
};

/**
 * Tells the core once a render is on the screen, so rects are measured on what is there. It sits
 * inside the one boundary that waits for the components to load, after the page: its effect runs
 * only once everything the render needs has arrived.
 */
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

/** What instances of a component have shown about it, by `from#component`. */
interface Learned {
  /** How the element holding its children lays them out, the last time it was seen. */
  readonly layouts: Map<string, ChildLayout>;
  /** Components that keep their props to themselves and are drawn inside a wrapper. */
  readonly wraps: Set<string>;
}

/** How one instance was drawn, and for which component: a reloaded module is asked again. */
interface InstanceSeen extends InstanceDrawn {
  readonly component: unknown;
}

interface InstanceStore {
  readonly get: (nodeId: string) => InstanceSeen | undefined;
  /** Records what an instance's effect found; the instance draws again when it changed. */
  readonly set: (nodeId: string, seen: InstanceSeen) => void;
  readonly subscribe: (nodeId: string, listener: () => void) => () => void;
}

/**
 * How instances were drawn, outside React: an instance can only know it once it is in the
 * DOM, so its effect writes it here and the instance, subscribed, draws again before the frame
 * is painted. What changed is reported to the editor too.
 */
const makeInstanceStore = (
  report: (nodeId: string, drawn: InstanceDrawn) => void
): InstanceStore => {
  const seen = new Map<string, InstanceSeen>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    get: (nodeId) => seen.get(nodeId),
    set: (nodeId, next) => {
      const before = seen.get(nodeId);
      if (
        before !== undefined &&
        before.component === next.component &&
        before.layout === next.layout &&
        before.wrapped === next.wrapped
      ) {
        return;
      }
      seen.set(nodeId, next);
      if (before?.layout !== next.layout || before.wrapped !== next.wrapped) {
        report(nodeId, { layout: next.layout, wrapped: next.wrapped });
      }
      for (const listener of listeners.get(nodeId) ?? []) {
        listener();
      }
    },
    subscribe: (nodeId, listener) => {
      const set = listeners.get(nodeId) ?? new Set();
      set.add(listener);
      listeners.set(nodeId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) {
          listeners.delete(nodeId);
        }
      };
    },
  };
};

/**
 * One lazy component per module and export, kept while the registry keeps the module, with
 * what its instances taught: a new instance starts from it instead of drawing twice.
 */
const makeComponents = (initial: ComponentRegistry) => {
  let registry = initial;
  const cache = new Map<string, ComponentType<Record<string, unknown>>>();
  const learned: Learned = { layouts: new Map(), wraps: new Set() };
  const componentOf = (node: InstanceNode) => {
    const load = registry[node.from];
    if (!load) {
      return null;
    }
    const key = `${node.from}#${node.component}`;
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    const component = lazy(async () => {
      const module = (await load()) as Record<string, unknown>;
      const found =
        module[node.component] ??
        (node.component === "default" ? module.default : undefined);
      return {
        default:
          (found as ComponentType<Record<string, unknown>> | undefined) ??
          ((props: Record<string, unknown>) =>
            createElement(Missing, {
              ...props,
              text: `${node.from} has no export ${node.component}`,
            })),
      };
    });
    cache.set(key, component);
    return component;
  };
  const replace = (next: ComponentRegistry) => {
    for (const key of cache.keys()) {
      const from = key.slice(0, key.lastIndexOf("#"));
      if (next[from] !== registry[from]) {
        cache.delete(key);
        learned.layouts.delete(key);
        learned.wraps.delete(key);
      }
    }
    registry = next;
  };
  return { componentOf, learned, replace };
};

export const renderToCanvas: RenderToCanvas = (setup: RenderSetup, canvas) => {
  const Providers = (setup.providers ?? PassThrough) as ComponentType<{
    children: ReactNode;
  }>;
  const root = createRoot(canvas);
  const components = makeComponents(setup.components);
  let last: RenderRequest | null = null;
  let designSystem: DesignSystem | null = null;
  let styles = makeStyleContext(null);
  const onError = (error: Error) =>
    setup.reportError({ message: error.message, stack: error.stack });

  // How instances were drawn goes to the editor once a frame, and only what changed.
  let unsent: Record<string, InstanceDrawn> = {};
  let sendScheduled = false;
  const sendInstances = () => {
    sendScheduled = false;
    const drawn = unsent;
    unsent = {};
    setup.reportInstances?.(drawn);
  };
  const report = (nodeId: string, drawn: InstanceDrawn) => {
    unsent[nodeId] = drawn;
    if (!sendScheduled) {
      sendScheduled = true;
      requestAnimationFrame(sendInstances);
    }
  };
  const instances = makeInstanceStore(report);

  let first = true;
  const draw = (request: RenderRequest) => {
    last = request;
    if (request.designSystem !== designSystem) {
      ({ designSystem } = request);
      styles = makeStyleContext(designSystem);
    }
    const scope: Scope = {
      assetUrl: setup.assetUrl,
      componentOf: components.componentOf,
      instances,
      learned: components.learned,
      navigate: setup.navigate,
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
        node: { ...node, minHeight: node.minHeight ?? "100vh" },
        parent: "free",
      });
    } else {
      body = createElement(NodeView, { node, parent: "free" });
    }
    const tree = createElement(
      Providers,
      null,
      createElement(
        ScopeContext.Provider,
        { value: scope },
        // One boundary for the whole render: a component still loading holds the render back
        // (a transition keeps the last one on screen meanwhile) instead of drawing a placeholder.
        createElement(
          Suspense,
          { fallback: null },
          createElement(
            Boundary,
            { key: "page", label: "The page", onError },
            body
          ),
          createElement(Rendered, {
            onRendered: setup.onRendered,
            renderId: request.renderId,
          })
        )
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
    setComponents: (next) => {
      components.replace(next);
      if (last) {
        draw(last);
      }
    },
    unmount: () => root.unmount(),
  };
  return mounted;
};
