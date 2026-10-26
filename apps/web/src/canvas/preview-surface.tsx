/**
 * A page drawn by the repository's components outside the canvas (ADR 0034): the prototype, the
 * type samples, a component's matrix. A shadow host in the editor's page, drawn by the preview
 * loaded once, spoken to through its bridge like a frame of the canvas.
 */
import type { HostMessage } from "@ultrapaint/contracts/preview";
import {
  type CSSProperties,
  useEffectEvent,
  useLayoutEffect,
  useRef,
} from "react";
import { bridgeFor, type FrameBridge, removeBridge } from "./bridge.ts";
import { usePreview } from "./preview-module.ts";

export const PreviewSurface = ({
  canvas = "",
  className,
  frameId,
  hostClassName = "block h-full w-full",
  interactive = false,
  onMessage,
  style,
  title,
}: {
  /** Whose images relative paths are: a canvas's own, else the shared ones. */
  canvas?: string;
  className?: string;
  frameId: string;
  hostClassName?: string;
  /** The page takes input: the prototype. Otherwise it is a picture. */
  interactive?: boolean;
  /** What the page says; `ed:ready` once it is drawn in and listened to. */
  onMessage: (msg: HostMessage, bridge: FrameBridge) => void;
  style?: CSSProperties;
  title?: string;
}) => {
  const preview = usePreview();
  const holder = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  const handle = useEffectEvent(onMessage);
  useLayoutEffect(() => {
    const el = holder.current;
    if (!(preview && el)) {
      return;
    }
    const host = document.createElement("div");
    host.className = hostClassName;
    host.dataset.edFrameHost = frameId;
    hostRef.current = host;
    el.append(host);
    const bridge = bridgeFor(frameId);
    const runtime = preview.mountFrame(host, {
      canvas,
      events: bridge.events(),
      frame: frameId,
    });
    bridge.attachRuntime(runtime);
    const off = bridge.on((msg) => handle(msg, bridge));
    bridge.announce();
    return () => {
      off();
      runtime.unmount();
      host.remove();
      hostRef.current = null;
      removeBridge(frameId);
    };
  }, [preview, frameId, canvas, hostClassName]);
  // What changes without drawing the page anew: the title it is read by, whether it takes input.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new preview is a new host to set.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    host.title = title ?? "";
    host.style.pointerEvents = interactive ? "auto" : "none";
    bridgeFor(frameId).setInteractive(interactive);
  }, [frameId, interactive, title, preview]);
  return <div className={className} ref={holder} style={style} />;
};
