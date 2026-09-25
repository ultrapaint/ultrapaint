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
} from "react";
import { createRoot } from "react-dom/client";

const NODE_ATTRIBUTE = "data-ed-node";

const ERROR_STYLE = {
  background: "#fef2f2",
  border: "1px dashed #f87171",
  color: "#b91c1c",
  fontFamily: "ui-monospace, monospace",
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
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  fontSize: 12,
  minHeight: 32,
  padding: "4px 8px",
} as const;

const MESSAGE_STYLE = {
  alignItems: "center",
  color: "#71717a",
  display: "flex",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
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
  readonly navigate: (route: string) => void;
  readonly styles: Omit<StyleContext, "parent">;
}

const ScopeContext = createContext<Scope | null>(null);

interface BoundaryProps {
  children?: ReactNode;
  label: string;
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
          { style: ERROR_STYLE },
          `${this.props.label}: ${error.message}`
        )
      : this.props.children;
  }
}

const PassThrough = ({ children }: { children: ReactNode }) =>
  createElement(Fragment, null, children);

const Message = ({ text }: { text: string }) =>
  createElement("div", { style: MESSAGE_STYLE }, text);

const Missing = ({ text }: { text: string }) =>
  createElement("span", { style: MISSING_STYLE }, text);

/** Whether the style asks for a box of its own, beyond the border-box every node gets. */
const hasBox = (style: Style) =>
  Object.keys(style).some((key) => key !== "boxSizing" && key !== "cursor");

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
    return createElement(InstanceView, { node, style });
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
 * An instance is the design system's own component. Its box fields go on a wrapper, which takes
 * no box of its own when there are none (`display: contents`), so the component lays out as it
 * would in the application.
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
  const children = childrenOf(node);
  const content =
    children.length > 0
      ? children.map((child) =>
          createElement(NodeView, {
            key: child.id,
            node: child,
            parent: "block",
          })
        )
      : node.text;
  const wrapperStyle = hasBox(style)
    ? { display: "flex", flexDirection: "column", ...style }
    : { display: "contents" };
  return createElement(
    "div",
    {
      [NODE_ATTRIBUTE]: node.id,
      "data-ed-instance": node.component,
      onClickCapture: onLink(scope, node.link),
      style: wrapperStyle,
    },
    createElement(
      Boundary,
      { key: `${node.from}#${node.component}`, label: node.component },
      Resolved
        ? createElement(Resolved, { ...(node.props ?? {}) }, content)
        : createElement(Missing, {
            text: `${node.component} is not in ${node.from}`,
          })
    )
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

/** One lazy component per module and export, kept while the registry keeps the module. */
const makeComponents = (initial: ComponentRegistry) => {
  let registry = initial;
  const cache = new Map<string, ComponentType<Record<string, unknown>>>();
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
          (() =>
            createElement(Missing, {
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
      }
    }
    registry = next;
  };
  return { componentOf, replace };
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
