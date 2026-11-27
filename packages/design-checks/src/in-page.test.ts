// @vitest-environment happy-dom
/**
 * The checks run on a root the caller holds, as the editor holds a frame (ADR 0034): an element or
 * a shadow root, its own window wherever it is placed. happy-dom lays nothing out, so each element
 * is given the box a browser would give it.
 */
import { afterEach, assert, beforeEach, describe, it } from "vitest";
import { spacingFindings } from "./findings.ts";
import { auditInBrowser, layoutInBrowser } from "./in-page.ts";

interface Rect {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

/** The box a browser would lay `el` out in. */
const place = (el: Element, r: Rect) => {
  const box = {
    ...r,
    bottom: r.y + r.height,
    left: r.x,
    right: r.x + r.width,
    top: r.y,
  };
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ ...box, toJSON: () => box }),
  });
};

/** An element shown at `r`, with `text` and `style` of its own. */
const shownAt = (r: Rect, text = "", style = "") => {
  const el = document.createElement("div");
  // happy-dom computes no opacity or visibility: they are given as a browser would compute them.
  el.style.cssText = `opacity:1;visibility:visible;${style}`;
  if (text) {
    el.textContent = text;
  }
  place(el, r);
  return el;
};

/** `count` rows of 28px from `y`, `gap` apart, each rounded: a list of rows. */
const rowsAt = (x: number, y: number, count: number, gap: number) =>
  Array.from({ length: count }, (_, i) =>
    shownAt(
      { height: 28, width: 200, x, y: y + i * (28 + gap) },
      `Row ${y}-${i + 1}`,
      "border-radius:4px"
    )
  );

/** A list holding `rows`, its box around them. */
const listOf = (rows: readonly Element[], x: number) => {
  const boxes = rows.map((r) => r.getBoundingClientRect());
  const top = boxes[0]?.top ?? 0;
  const bottom = boxes.at(-1)?.bottom ?? 0;
  const list = shownAt({ height: bottom - top, width: 200, x, y: top });
  list.append(...rows);
  return list;
};

const range = Range.prototype as { getClientRects: unknown };
const clientRects = range.getClientRects;

beforeEach(() => {
  // A text's lines are its element's box: one line a row.
  range.getClientRects = function (this: Range) {
    const node = this.startContainer;
    const el = node instanceof Element ? node : node.parentElement;
    return el ? [el.getBoundingClientRect()] : [];
  };
});

afterEach(() => {
  range.getClientRects = clientRects;
  document.body.replaceChildren();
});

describe("a root given as an element or a shadow root", () => {
  it("is audited as its own window, wherever it is placed in the page", () => {
    // A frame of the editor: a shadow root on a host placed far off the window.
    const host = shownAt({ height: 400, width: 600, x: -20_000, y: 0 });
    document.body.append(host);
    const frame = host.attachShadow({ mode: "open" });
    frame.append(listOf(rowsAt(-19_990, 40, 4, 0), -19_990));

    const inFrame = auditInBrowser({
      grid: 0,
      nearTone: 0.045,
      only: ["touching-rows"],
      root: frame,
      stress: false,
    });
    assert.deepStrictEqual(
      inFrame.findings.map((f) => [
        f.check,
        f.label.slice(0, 8),
        f.value,
        f.box,
      ]),
      [
        [
          "touching-rows",
          "Row 40-1",
          28,
          { height: 112, width: 200, x: 10, y: 40 },
        ],
      ]
    );
    // By a selector, the window is the page's: the frame is off it, and nothing is seen.
    assert.deepStrictEqual(
      auditInBrowser({
        grid: 0,
        nearTone: 0.045,
        only: ["touching-rows"],
        root: "body",
        stress: false,
      }).findings,
      []
    );
  });

  it("is laid out from its own corner, for the groups' spacing", () => {
    const panel = shownAt({ height: 300, width: 220, x: 500, y: 100 });
    // Two lists of rows 10px apart within, 27px between them: under 3×.
    const app = listOf(rowsAt(510, 120, 3, 10), 510);
    const system = listOf(rowsAt(510, 251, 3, 10), 510);
    panel.append(app, system);
    document.body.append(panel);

    const { block } = layoutInBrowser(panel);
    assert.isNotNull(block);
    const found = block ? spacingFindings(block) : [];
    assert.deepStrictEqual(
      found.map((f) => [f.between, f.within, f.ratio, f.belowBox.x]),
      [[27, 10, 3, 10]]
    );
  });
});

describe("a text cut on purpose", () => {
  /**
   * A text of 300px of words in a 200px box, drawn with `style`. happy-dom computes no longhand
   * of `overflow`: `overflow-x` is given as a browser would compute it.
   */
  const cut = (style: string, height = 20) => {
    const el = shownAt(
      { height, width: 200, x: 0, y: 0 },
      "A long name",
      style
    );
    Object.defineProperty(el, "scrollWidth", { value: 300 });
    Object.defineProperty(el, "clientWidth", { value: 200 });
    return el;
  };
  const clipped = (root: Element) =>
    auditInBrowser({
      grid: 0,
      nearTone: 0.045,
      only: ["clipped-text"],
      root,
      stress: false,
    }).findings.map((f) => f.check);

  it("to one line with an ellipsis, or clamped, is not clipped; one cut with neither is", () => {
    const oneLine = cut(
      "overflow-x:hidden;text-overflow:ellipsis;white-space:nowrap"
    );
    const clamped = shownAt(
      { height: 40, width: 200, x: 0, y: 30 },
      "A description clamped to two lines",
      "overflow-x:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2"
    );
    // Its lines wrap inside its width, and those past the second are cut below.
    for (const [name, value] of [
      ["scrollWidth", 200],
      ["clientWidth", 200],
      ["scrollHeight", 80],
      ["clientHeight", 40],
    ] as const) {
      Object.defineProperty(clamped, name, { value });
    }
    const panel = shownAt({ height: 100, width: 200, x: 0, y: 0 });
    panel.append(oneLine, clamped);
    document.body.append(panel);
    assert.deepStrictEqual(clipped(panel), []);
    // What is cut with no ellipsis is still found.
    panel.append(cut("overflow-x:hidden"));
    assert.deepStrictEqual(clipped(panel), ["clipped-text"]);
  });
});

describe("a block's label", () => {
  /** A section of a heading and the text under it, laid out from `y`. */
  const sectionAt = (y: number, heading: string) => {
    const section = shownAt({ height: 100, width: 400, x: 0, y });
    section.append(
      shownAt({ height: 20, width: 400, x: 0, y }, heading),
      shownAt(
        { height: 60, width: 400, x: 0, y: y + 30 },
        "Every plan includes the editor"
      )
    );
    return section;
  };
  const labels = (...blocks: Element[]) => {
    const panel = shownAt({ height: 400, width: 400, x: 0, y: 0 });
    panel.append(...blocks);
    document.body.append(panel);
    return layoutInBrowser(panel).block?.children.map((c) => c.label);
  };

  it("is its first line, not a heading run into the text under it", () => {
    assert.deepStrictEqual(
      labels(
        sectionAt(0, "Two plans"),
        shownAt({ height: 20, width: 400, x: 0, y: 140 }, "Questions")
      ),
      ["Two plans", "Questions"]
    );
  });

  it("is cut at a word with an ellipsis past 40 characters", () => {
    assert.deepStrictEqual(
      labels(
        shownAt({ height: 20, width: 400, x: 0, y: 0 }, "Pricing"),
        sectionAt(40, "Choose the plan that fits your growing design team")
      ),
      ["Pricing", "Choose the plan that fits your growing…"]
    );
  });
});
