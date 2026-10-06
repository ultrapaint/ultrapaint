// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { readTokens } from "./tokens.ts";

describe("the tokens a page defines", () => {
  it("are the custom properties of its root rules, resolved, by prefix when asked", () => {
    document.head.innerHTML = `<style>
:root { --color-primary: #123456; --radius-lg: 8px; color: red; }
.card { --card-only: 1px; }
</style>`;
    expect(readTokens()).toEqual({
      "--color-primary": "#123456",
      "--radius-lg": "8px",
    });
    expect(readTokens(["--color-"])).toEqual({ "--color-primary": "#123456" });
  });
});
