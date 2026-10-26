/**
 * Windowing for a long list whose lines have known heights: only the lines on screen, and a few
 * either side, are drawn; what is above and below them is room. The Layers panel lists every node
 * of a canvas, thousands on a large one, and draws a few dozen.
 */
import { type RefObject, useLayoutEffect, useState } from "react";

/** The tops of lines of these heights, and the whole height after the last. */
export const offsetsOf = (heights: readonly number[]): number[] => {
  const tops = [0];
  for (const h of heights) {
    tops.push((tops.at(-1) as number) + h);
  }
  return tops;
};

/** The first line whose bottom is below `y`, by halving: `tops` ends with the whole height. */
const lineAt = (tops: readonly number[], y: number) => {
  let low = 0;
  let high = tops.length - 2;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if ((tops[mid] as number) <= y) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return Math.max(0, low);
};

/**
 * The lines to draw, `[start, end)`, for a list scrolled to `scrollTop` and `height` high, with
 * `overscan` pixels either side drawn too, so a scroll shows lines already there.
 */
export const windowOf = (
  tops: readonly number[],
  scrollTop: number,
  height: number,
  overscan: number
): { end: number; start: number } => {
  const count = tops.length - 1;
  if (count <= 0) {
    return { end: 0, start: 0 };
  }
  const start = lineAt(tops, Math.max(0, scrollTop - overscan));
  const end = lineAt(tops, scrollTop + height + overscan) + 1;
  return { end: Math.min(count, end), start };
};

/** Scrolls `el` as little as it takes for `[top, bottom)` to be seen; whether it moved. */
const scrollSpan = (el: HTMLElement, top: number, bottom: number) => {
  let next = el.scrollTop;
  if (top < next) {
    next = top;
  } else if (bottom > next + el.clientHeight) {
    next = bottom - el.clientHeight;
  }
  if (next === el.scrollTop) {
    return false;
  }
  el.scrollTop = next;
  return true;
};

/**
 * Where a list's scroll is and how high it shows, kept up to date as it scrolls and resizes, and
 * a way to scroll a span into view: the span is drawn at once, before the browser has scrolled.
 */
export const useListWindow = (list: RefObject<HTMLElement | null>) => {
  const [view, setView] = useState({ height: 0, scrollTop: 0 });
  // Measured before the first paint, so the list is never drawn for a height of nothing.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) {
      return;
    }
    let pending: number | null = null;
    const read = () => {
      pending = null;
      setView((v) =>
        v.height === el.clientHeight && v.scrollTop === el.scrollTop
          ? v
          : { height: el.clientHeight, scrollTop: el.scrollTop }
      );
    };
    const soon = () => {
      pending ??= requestAnimationFrame(read);
    };
    const ro = new ResizeObserver(read);
    ro.observe(el);
    el.addEventListener("scroll", soon, { passive: true });
    read();
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", soon);
      if (pending !== null) {
        cancelAnimationFrame(pending);
      }
    };
  }, [list]);

  /** Scrolls as little as it takes for `[top, bottom)` to be seen. */
  const scrollIntoView = (top: number, bottom: number) => {
    const el = list.current;
    if (el && scrollSpan(el, top, bottom)) {
      setView({ height: el.clientHeight, scrollTop: el.scrollTop });
    }
  };

  return { ...view, scrollIntoView };
};
