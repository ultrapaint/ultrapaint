import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { fillTemplate, VIEWERS, viewerPage } from "./layout.ts";

const A_PAGE = /^<!doctype html>/;

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

describe("a viewer's page", () => {
  it.effect.each(VIEWERS)(
    "%s is read from the repository, with no data directory to hold it",
    (name) =>
      Effect.gen(function* () {
        assert.match(yield* viewerPage(name), A_PAGE);
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
