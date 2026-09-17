/**
 * Mounts a screen with the target repository's own React. This module is bundled with `react`
 * left as an import, so it is the repository's copy, the one the design system uses, that
 * renders the screen.
 */
import type { RenderToCanvas } from "@ultrapaint/framework-api/browser";
import {
  Component,
  type ComponentType,
  createElement,
  Fragment,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";

const ERROR_STYLE = {
  color: "#b00020",
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  padding: 16,
  whiteSpace: "pre-wrap",
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

export const renderToCanvas: RenderToCanvas = (input, canvas) => {
  const Screen = input.component as ComponentType;
  const Providers = (input.providers ?? PassThrough) as ComponentType<{
    children: ReactNode;
  }>;
  const root = createRoot(canvas);
  root.render(
    createElement(
      Boundary,
      {
        onError: (error) =>
          input.reportError({ message: error.message, stack: error.stack }),
      },
      createElement(Providers, null, createElement(Screen))
    )
  );
  return () => root.unmount();
};
