// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { elementAt } from "./hit.ts";

const PAINTS_NOTHING =
  "background-color: transparent; background-image: none; box-shadow: none; backdrop-filter: none; border-top-width: 0px; border-right-width: 0px; border-bottom-width: 0px; border-left-width: 0px";

const byId = (id: string) => document.getElementById(id) as Element;

/** What the browser would answer at a point; happy-dom does no hit-testing of its own. */
const stack = (answer: () => Element[]) => {
  document.elementsFromPoint = () => answer();
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the element at a point", () => {
  it("is the leaf the page answers with", () => {
    document.body.innerHTML = `<main id="main"><button id="button">Go</button></main>`;
    stack(() => [byId("button"), byId("main"), document.body]);
    expect(elementAt(1, 1)).toBe(byId("button"));
  });

  it("looks through a popup's dismiss sheet and the inert it puts on the page, and puts them back", () => {
    document.body.innerHTML = `<main id="main" inert><button id="button">Go</button></main>
<div id="sheet" style="position: fixed; ${PAINTS_NOTHING}"></div>`;
    const sheet = byId("sheet");
    sheet.getBoundingClientRect = () =>
      ({ height: window.innerHeight, width: window.innerWidth }) as DOMRect;
    // An inert page is out of hit-testing: the browser answers with the sheet, then the body.
    stack(() =>
      document.querySelector("[inert]")
        ? [sheet, document.body]
        : [sheet, byId("button"), byId("main"), document.body]
    );
    expect(elementAt(1, 1)).toBe(byId("button"));
    expect(byId("main").hasAttribute("inert")).toBe(true);
  });

  it("keeps the page's answer over an element it holds that is drawn on top", () => {
    document.body.innerHTML = `<div id="card"><span id="icon"></span><p id="text">Hi</p></div>`;
    let unblocked = false;
    stack(() => {
      // The second lookup is the one with the defences down.
      const answer = unblocked ? [byId("icon")] : [byId("card")];
      unblocked = true;
      return answer;
    });
    expect(elementAt(1, 1)).toBe(byId("icon"));
  });
});
