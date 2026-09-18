/**
 * Mounts a space with the target repository's own React. This module is bundled with `react`
 * left as an import, so it is the repository's copy, the one the design system uses, that
 * renders the pages.
 *
 * The providers are mounted once and stay mounted: navigating swaps the page under them, the
 * way a router does in the real application, so what a provider holds survives the click.
 * A navigation is a transition, and the one `Suspense` sits above the page's boundary, so the
 * page being left stays on screen until the next one has loaded instead of a blank frame.
 */
import type {
  Mounted,
  PageRoute,
  RenderToCanvas,
} from "@ultrapaint/framework-api/browser";
import {
  Component,
  type ComponentType,
  createElement,
  Fragment,
  lazy,
  type ReactNode,
  Suspense,
  startTransition,
} from "react";
import { createRoot } from "react-dom/client";

const ERROR_STYLE = {
  color: "#b00020",
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  padding: 16,
  whiteSpace: "pre-wrap",
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

interface BoundaryProps {
  children?: ReactNode;
  onError: (error: Error) => void;
}

class Boundary extends Component<BoundaryProps, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  override render() {
    const { error } = this.state;
    return error
      ? createElement(
          "pre",
          { style: ERROR_STYLE },
          String(error.stack ?? error.message)
        )
      : this.props.children;
  }
}

const PassThrough = ({ children }: { children: ReactNode }) =>
  createElement(Fragment, null, children);

const Message = ({ text }: { text: string }) =>
  createElement("div", { style: MESSAGE_STYLE }, text);

/**
 * One lazy component per page file, kept across navigations: the module is imported once and
 * going back to a page is immediate.
 */
const loaded = new Map<string, ComponentType>();

const componentFor = (page: PageRoute): ComponentType => {
  const cached = loaded.get(page.path);
  if (cached) {
    return cached;
  }
  const component = lazy(async () => {
    const module = (await page.load()) as { default?: ComponentType };
    return {
      default:
        module.default ??
        (() =>
          createElement(Message, {
            text: `${page.path} has no default export`,
          })),
    };
  });
  loaded.set(page.path, component);
  return component;
};

export const renderToCanvas: RenderToCanvas = (input, canvas) => {
  const Providers = (input.providers ?? PassThrough) as ComponentType<{
    children: ReactNode;
  }>;
  const root = createRoot(canvas);
  const onError = (error: Error) =>
    input.reportError({ message: error.message, stack: error.stack });

  const draw = ({ page, route }: Pick<typeof input, "page" | "route">) => {
    root.render(
      createElement(
        Providers,
        null,
        // Outside the keyed boundary, so it is the same boundary from one page to the next:
        // only a boundary already showing something holds it through a transition.
        createElement(
          Suspense,
          null,
          // Keyed by route: a page that threw must not keep the next one from rendering.
          createElement(
            Boundary,
            { key: route, onError },
            page
              ? createElement(componentFor(page), { key: page.path })
              : createElement(Message, { text: `No page for ${route}` })
          )
        )
      )
    );
  };

  draw(input);
  const mounted: Mounted = {
    unmount: () => root.unmount(),
    update: (next) => startTransition(() => draw(next)),
  };
  return mounted;
};
