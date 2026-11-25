/**
 * Paint while you wait (ADR 0099): the pointer, anywhere over the splash but its buttons, lays
 * strokes of the accent that dry away in about a second and a half. Faster is thinner, as a brush
 * dragged across paper, but never a hairline. The strokes are drawn opaque on a layer shown at
 * half strength, which loses a little each frame, so where they cross no joint shows.
 *
 * A step of the opening never wipes it, and neither does the desktop app's tab giving its start
 * page's place to the editor's page once the server is up, both of the app's own origin: the
 * start page leaves its paint in the tab's session storage, and the editor's splash
 * (`index.html`'s, then React's) takes it up as it has dried since.
 */
import { type RefObject, useEffect, useRef } from "react";

/** How much of the paint dries each frame. */
const DRYING = 0.035;
/** A pause longer than this starts a new stroke: the pointer was lifted, or left. */
const GAP_MS = 80;
/** With nothing painted for this long the layer is wiped: 8-bit drying leaves a faint residue. */
const CLEAN_AFTER_MS = 2000;
/**
 * Where the start page leaves its paint for the editor's page in the same tab: `CarriedPaint`,
 * as JSON. `index.html` reads it too.
 */
const CARRIED_PAINT = "ultrapaint:splash-paint";
/** How long a frame lasts, in milliseconds: the drying is counted in frames. */
const FRAME_MS = 1000 / 60;

/** The width of the stroke from one pointer move to the next, `distance` apart: 14px at rest. */
export const strokeWidth = (distance: number) =>
  Math.max(6, 14 - distance * 0.2);

/** How much of paint laid `ms` ago is left: what the drying of each frame leaves of it. */
export const leftAfter = (ms: number) =>
  ms >= CLEAN_AFTER_MS ? 0 : (1 - DRYING) ** (Math.max(0, ms) / FRAME_MS);

/** Paint carried to the editor's page: the layer as a picture, and when it was taken. */
interface CarriedPaint {
  readonly at: number;
  readonly image: string;
}

/** Takes up the paint the start page left, when some of it is still wet. */
const takeCarried = (): CarriedPaint | null => {
  try {
    const text = sessionStorage.getItem(CARRIED_PAINT);
    sessionStorage.removeItem(CARRIED_PAINT);
    const carried = text ? (JSON.parse(text) as CarriedPaint) : null;
    return carried && leftAfter(Date.now() - carried.at) > 0 ? carried : null;
  } catch {
    // No storage (a sandboxed page) or what it held unreadable: the splash starts clean.
    return null;
  }
};

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
    // When paint was last laid, on the frames' clock: never, so far.
    let lastPainted = Number.NEGATIVE_INFINITY;
    const carried = takeCarried();
    if (carried) {
      const image = new Image();
      image.onload = () => {
        ctx.globalAlpha = leftAfter(Date.now() - carried.at);
        ctx.drawImage(image, 0, 0, width, height);
        ctx.globalAlpha = 1;
        // Wiped 2 s after it was laid, as it would have been on the start page, unless painted
        // on since.
        lastPainted = Math.max(
          lastPainted,
          performance.now() - (Date.now() - carried.at)
        );
      };
      image.src = carried.image;
    }
    // The page goes with paint still wet: it is left for the editor's page in this tab.
    const keep = () => {
      if (performance.now() - lastPainted > CLEAN_AFTER_MS) {
        return;
      }
      try {
        sessionStorage.setItem(
          CARRIED_PAINT,
          JSON.stringify({
            at: Date.now(),
            image: layer.toDataURL(),
          } satisfies CarriedPaint)
        );
      } catch {
        // Storage full or refused: the paint goes with its page, as it did before.
      }
    };
    window.addEventListener("pagehide", keep);
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
          width: strokeWidth(distance),
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
      window.removeEventListener("pagehide", keep);
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
