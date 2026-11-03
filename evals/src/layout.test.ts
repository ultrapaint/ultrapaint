import { assert, describe, it } from "@effect/vitest";
import { fillTemplate } from "./layout.ts";

describe("a prompt's template", () => {
  it("has each {{name}} filled in, and one without a value left as it is", () => {
    assert.strictEqual(
      fillTemplate("{{brief}} at {{viewports}}; {{brief}} again; {{unknown}}", {
        brief: "A $& brief",
        viewports: "a phone 390 wide",
      }),
      "A $& brief at a phone 390 wide; A $& brief again; {{unknown}}"
    );
  });
});
