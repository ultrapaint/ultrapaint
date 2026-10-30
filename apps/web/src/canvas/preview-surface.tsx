/**
 * A frame drawn outside the page canvas (ADR 0034): the prototype, the boards of Design system and
 * the Library. A frame of the editor's page (`editor-frame.ts`), opened while this is shown and
 * put away after; what it draws its caller says with `useFrameDrawing`.
 */
import { type CSSProperties, useLayoutEffect, useRef } from "react";
import {
  type FrameListeners,
  frameOf,
  useFrameEvents,
} from "./editor-frame.ts";
import { usePreview } from "./preview-module.ts";

const NO_LISTENERS: FrameListeners = {};

export const PreviewSurface = ({
  canvas = "",
  className,
  frameId,
  hostClassName = "block h-full w-full",
  interactive = false,
  listeners,
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
  /**
   * What the page says; `ready` once it is drawn in and listened to. What it draws its caller
   * says with `useFrameDrawing`.
   */
  listeners?: FrameListeners;
  style?: CSSProperties;
  title?: string;
}) => {
  const preview = usePreview();
  const holder = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = holder.current;
    if (!el) {
      return;
    }
    return frameOf(frameId).open({
      canvas,
      className: hostClassName,
      holder: el,
      preview,
    }).close;
  }, [preview, frameId, canvas, hostClassName]);
  // What changes without drawing the page anew: the title it is read by, whether it takes input.
  useLayoutEffect(() => {
    const frame = frameOf(frameId);
    frame.setTitle(title ?? "");
    frame.setInteractive(interactive);
  }, [frameId, interactive, title]);
  useFrameEvents(frameId, listeners ?? NO_LISTENERS);
  return <div className={className} ref={holder} style={style} />;
};
