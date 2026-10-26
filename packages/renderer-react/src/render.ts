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
import { DRAFT_FROM } from "@ultrapaint/contracts/spec-names";
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
  type ComponentRegistry,
  type Mounted,
  NODE_ATTRIBUTE,
  nodeSelector,
  type RenderRequest,
  type RenderSetup,
  type RenderToCanvas,
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

/** The attribute the nodes of a draft's tree are marked with: not the page's, so not selectable. */
const DRAFT_NODE_ATTRIBUTE = "data-ed-draft-node";

/** What every node of one render needs, handed down without threading it through props. */
interface Scope {
  readonly assetUrl: (src: string) => string;
  readonly componentOf: (
    node: InstanceNode
  ) => ComponentType<Record<string, unknown>> | null;
  /** The trees of the draft components (ADR 0029), by component name. */
  readonly drafts: ReadonlyMap<string, DesignNode>;
  /** How each instance was drawn, which the instance reads and its effect writes. */
  readonly instances: InstanceStore;
  /** What earlier instances of a component taught: whether it wraps, how it lays out. */
  readonly learned: Learned;
  readonly navigate: (route: string) => void;
  /**
   * What a node's id is written in: the page's attribute, or, inside a draft's tree, one the
   * editor does not read, so only the draft's instance can be selected.
   */
  readonly nodeAttribute: string;
  /** Where the render's elements are looked up: its document, or the frame's shadow root. */
  readonly root: ParentNode;
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
 * Keeps one component that throws from taking the rest of the page with it. The error stays
 * until what is drawn changes, a prop fixed or the component reloaded, and is then tried again.
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
/**
 * A draft component's instance (ADR 0029): the draft's tree drawn in its place, its root carrying
 * the instance's id, marks and box, so the instance is what is selected, and the spec's styles
 * reach it as they reach a component. The instance's text replaces the tree's first text.
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
  const marks = {
    [scope.nodeAttribute]: node.id,
    [COMPONENT_ATTRIBUTE]: node.component,
    [VARIANT_ATTRIBUTE]: variantAttributeOf(node.props),
    "data-ed-instance": node.component,
  };
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

const InstanceView = ({
  node,
  style,
}: {
  node: InstanceNode;
  style: Style;
}): ReactNode => {
  if (node.from === DRAFT_FROM) {
    return createElement(DraftView, { node, style });
  }
  return createElement(ComponentInstanceView, { node, style });
};

const ComponentInstanceView = ({
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

  const attribute = scope.nodeAttribute;
  const selectorOf = (id: string) =>
    attribute === NODE_ATTRIBUTE
      ? nodeSelector(id)
      : `[${attribute}="${CSS.escape(id)}"]`;
  useLayoutEffect(() => {
    const own = scope.root.querySelector(selectorOf(node.id));
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
        : scope.root.querySelector(selectorOf(firstChild));
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
      {
        key,
        label: node.component,
        nodeId: wrapped ? undefined : node.id,
        resetKeys: [node, Resolved],
      },
      Resolved
        ? createElement(Resolved, { ...props, ...extra }, content)
        : createElement(Missing, {
            ...extra,
            text: `${node.component} is not in ${node.from}`,
          })
    );

  // What a component spec's stylesheet finds the instance by (ADR 0029).
  const marks = {
    [COMPONENT_ATTRIBUTE]: node.component,
    [VARIANT_ATTRIBUTE]: variantAttributeOf(props),
  };
  if (!wrapped) {
    const own = isRecord(props.style) ? props.style : {};
    return component({
      [attribute]: node.id,
      "data-ed-instance": node.component,
      ...marks,
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
      [attribute]: node.id,
      "data-ed-instance": node.component,
      ...marks,
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
const makeComponents = (initial: ComponentRegistry): Components => {
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
  /** The loaders already started, so each module is asked for once. */
  const started = new Set<() => Promise<unknown>>();
  /**
   * Starts loading every module the tree's instances come from, all at once. Drawn, each
   * component loads only once React reaches it, and one inside another waits for the outer one:
   * a page of nested components loaded them one after the other.
   */
  const preload = (root: DesignNode) => {
    const walk = (node: DesignNode) => {
      if (node.type === "instance") {
        const load = registry[node.from];
        if (load && !started.has(load)) {
          started.add(load);
          // A module that fails is reported where its instance is drawn.
          load().catch(() => undefined);
        }
      }
      for (const child of childrenOf(node)) {
        walk(child);
      }
    };
    walk(root);
  };
  /** How many times the registry was replaced: a reloaded module may no longer throw. */
  let replaced = 0;
  const replace = (next: ComponentRegistry) => {
    replaced += 1;
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
  return {
    componentOf,
    generation: () => replaced,
    learned,
    preload,
    replace,
  };
};

interface Components {
  readonly componentOf: (
    node: InstanceNode
  ) => ComponentType<Record<string, unknown>> | null;
  readonly generation: () => number;
  readonly learned: Learned;
  readonly preload: (root: DesignNode) => void;
  readonly replace: (next: ComponentRegistry) => void;
}

/**
 * The components of a registry, shared by everything drawn from it: frames of the editor's page
 * all draw from the one registry, and a component loaded for one draws in the next at once,
 * without waiting (React holds back what suspends, even for a module already there).
 */
const shared = new WeakMap<ComponentRegistry, Components>();
const componentsFor = (registry: ComponentRegistry): Components => {
  let found = shared.get(registry);
  if (!found) {
    found = makeComponents(registry);
    shared.set(registry, found);
  }
  return found;
};

export const renderToCanvas: RenderToCanvas = (setup: RenderSetup, canvas) => {
  const Providers = (setup.providers ?? PassThrough) as ComponentType<{
    children: ReactNode;
  }>;
  const root = createRoot(canvas);
  const lookup = canvas.getRootNode() as ParentNode;
  let components = componentsFor(setup.components);
  let last: RenderRequest | null = null;
  let designSystem: DesignSystem | null = null;
  let styles = makeStyleContext(null);
  let specs: readonly ComponentSpec[] | undefined;
  let drafts: ReadonlyMap<string, DesignNode> = new Map();
  /**
   * The design's own stylesheet (ADR 0028, 0029): the tokens' values over the code's and the
   * component specs, after everything else in the document so it wins without `!important`.
   */
  const sheet = document.createElement("style");
  sheet.setAttribute("data-ed-design", "");
  const placeSheet = (css: string) => {
    if (setup.setDesignCss) {
      setup.setDesignCss(css);
      return;
    }
    if (sheet.textContent !== css) {
      sheet.textContent = css;
    }
    if (sheet.parentNode !== document.head || sheet.nextSibling !== null) {
      document.head.append(sheet);
    }
  };
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
    if (restyled) {
      placeSheet(
        [tokenCss ?? "", specCss(specs ?? [], styles)]
          .filter(Boolean)
          .join("\n\n")
      );
    }
  };

  const draw = (request: RenderRequest) => {
    last = request;
    restyle(request);
    const scope: Scope = {
      assetUrl: setup.assetUrl,
      componentOf: components.componentOf,
      drafts,
      instances,
      learned: components.learned,
      navigate: setup.navigate,
      nodeAttribute: NODE_ATTRIBUTE,
      root: lookup,
      styles,
    };
    const { root: node } = request;
    if (node) {
      components.preload(node);
    }
    let body: ReactNode;
    if (request.message !== undefined || node === null) {
      body = createElement(Message, {
        text: request.message ?? "Nothing to show",
      });
    } else if (request.mode === "page" && node.type === "page") {
      body = createElement(NodeView, {
        node: {
          ...node,
          minHeight: node.minHeight ?? setup.pageHeight ?? "100vh",
        },
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
            {
              key: "page",
              label: "The page",
              onError,
              resetKeys: [request, components.generation()],
            },
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
      const known = shared.get(next);
      if (known) {
        components = known;
      } else {
        components.replace(next);
        shared.set(next, components);
      }
      if (last) {
        draw(last);
      }
    },
    unmount: () => root.unmount(),
  };
  return mounted;
};
