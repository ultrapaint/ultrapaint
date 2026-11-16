/**
 * Paint while you wait (ADR 0099): the pointer, anywhere over the splash but its buttons, lays
 * strokes of the accent that dry away in about a second and a half. Faster is thinner, as a brush
 * dragged across paper. The strokes are drawn opaque on a layer shown at half strength, which
 * loses a little each frame, so where they cross no joint shows.
 */
import { type RefObject, useEffect, useRef } from "react";

/** How much of the paint dries each frame. */
const DRYING = 0.035;
/** A pause longer than this starts a new stroke: the pointer was lifted, or left. */
const GAP_MS = 80;
/** With nothing painted for this long the layer is wiped: 8-bit drying leaves a faint residue. */
const CLEAN_AFTER_MS = 2000;

interface Point {
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

export const PaintLayer = ({
  over,
}: {
  /** The element the pointer paints over; the layer fills it. */
  readonly over: RefObject<HTMLElement | null>;
}) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const area = over.current;
    const layer = canvas.current;
    const ctx = layer?.getContext("2d");
    if (!(area && layer && ctx)) {
      return;
    }
    let width = 0;
    let height = 0;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = area.clientWidth;
      height = area.clientHeight;
      layer.width = width * ratio;
      layer.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let last: Point | null = null;
    let lastPainted = 0;
    const strokes: { a: Point; b: Point; width: number }[] = [];
    const move = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest("button")) {
        last = null;
        return;
      }
      const box = area.getBoundingClientRect();
      const point = {
        t: performance.now(),
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      };
      if (last && point.t - last.t < GAP_MS) {
        const distance = Math.hypot(point.x - last.x, point.y - last.y);
        strokes.push({
          a: last,
          b: point,
          width: Math.max(2, 14 - distance * 0.35),
        });
      }
      last = point;
    };
    const leave = () => {
      last = null;
    };
    area.addEventListener("pointermove", move);
    area.addEventListener("pointerleave", leave);

    let frame = requestAnimationFrame(function draw(now) {
      if (strokes.length > 0) {
        lastPainted = now;
      } else if (now - lastPainted > CLEAN_AFTER_MS) {
        ctx.clearRect(0, 0, width, height);
      }
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0, 0, 0, ${DRYING})`;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
      if (strokes.length > 0) {
        // The accent of the moment: the person's choice in Settings › Appearance.
        ctx.strokeStyle = getComputedStyle(area)
          .getPropertyValue("--primary")
          .trim();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const stroke of strokes.splice(0)) {
          ctx.lineWidth = stroke.width;
          ctx.beginPath();
          ctx.moveTo(stroke.a.x, stroke.a.y);
          ctx.lineTo(stroke.b.x, stroke.b.y);
          ctx.stroke();
        }
      }
      frame = requestAnimationFrame(draw);
    });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      area.removeEventListener("pointermove", move);
      area.removeEventListener("pointerleave", leave);
    };
  }, [over]);
  return (
    <canvas
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full opacity-50"
      ref={canvas}
    />
  );
};
