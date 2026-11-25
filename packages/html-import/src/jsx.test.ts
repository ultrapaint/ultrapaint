import { describe, expect, it } from "vitest";
import { isJsx } from "./jsx.ts";

describe("telling JSX from HTML", () => {
  it("reads a component, a fragment, a React prop or an expression as JSX", () => {
    for (const text of [
      `<Card title="Plan">x</Card>`,
      "<>\n  <p>x</p>\n</>",
      `<div className="p-4">x</div>`,
      `<label htmlFor="name">Name</label>`,
      "<button onClick={go}>Buy</button>",
      `<div className = "p-4">x</div>`,
      "<button onClick = {go}>Buy</button>",
    ]) {
      expect(isJsx(text)).toBe(true);
    }
  });

  it("reads markup a browser or an editor of HTML writes as HTML", () => {
    for (const text of [
      `<div class="flex gap-4"><p>Pay {as} you go</p></div>`,
      "<P>An old page</P><BR>",
      "<p>x = {1, 2}</p>",
      `<a href="/docs">Docs</a>`,
    ]) {
      expect(isJsx(text)).toBe(false);
    }
  });
});
