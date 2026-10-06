// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { elementsOf, unionRect } from "./dom.ts";

/** Gives an element the box the browser would lay it out in; happy-dom lays nothing out. */
const place = (
  el: Element | null,
  x: number,
  y: number,
  w: number,
  h: number
) => {
  if (el) {
    el.getBoundingClientRect = () =>
      ({
        bottom: y + h,
        height: h,
        left: x,
        right: x + w,
        top: y,
        width: w,
        x,
        y,
      }) as DOMRect;
  }
};

const byId = (id: string) => document.getElementById(id);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the elements a node is drawn as", () => {
  it("are the element with its id, or what a box-less wrapper holds", () => {
    document.body.innerHTML = `
<p id="text" data-ed-node="t">Hi</p>
<div id="wrapper" data-ed-node="w" style="display: contents"><span id="a"></span><span id="b"></span></div>`;
    expect(elementsOf("t")).toEqual([byId("text")]);
    expect(elementsOf("w")).toEqual([byId("a"), byId("b")]);
    expect(elementsOf("none")).toEqual([]);
  });
});

describe("the rectangle of a node", () => {
  it("covers every element it is drawn as, past one that takes no room", () => {
    document.body.innerHTML = `<span id="a"></span><span id="b"></span><span id="flat"></span>`;
    place(byId("a"), 10, 20, 30, 10);
    place(byId("b"), 50, 0, 10, 10);
    place(byId("flat"), 500, 500, 0, 10);
    const els = ["a", "b", "flat"].map((id) => byId(id) as Element);
    expect(unionRect(els)).toEqual({ height: 30, width: 50, x: 10, y: 0 });
  });

  it("leaves out a popup's empty fixed sheet, and still measures what draws nothing when that is all", () => {
    // happy-dom computes nothing it is not told: the sheet says what a browser would compute.
    const paintsNothing =
      "background-color: transparent; background-image: none; box-shadow: none; backdrop-filter: none; border-top-width: 0px; border-right-width: 0px; border-bottom-width: 0px; border-left-width: 0px";
    document.body.innerHTML = `<div id="popup"></div><div id="sheet" style="position: fixed; ${paintsNothing}"></div>`;
    place(byId("popup"), 100, 100, 200, 50);
    place(byId("sheet"), 0, 0, 1000, 800);
    const popup = byId("popup") as Element;
    const sheet = byId("sheet") as Element;
    expect(unionRect([popup, sheet])).toEqual({
      height: 50,
      width: 200,
      x: 100,
      y: 100,
    });
    expect(unionRect([sheet])).toEqual({
      height: 800,
      width: 1000,
      x: 0,
      y: 0,
    });
  });
});
