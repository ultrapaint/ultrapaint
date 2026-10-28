import { assert, describe, it } from "@effect/vitest";
import { PRIMITIVES_FROM } from "@ultrapaint/contracts/spec-names";
import { Effect } from "effect";
import { CatalogueService } from "./services/catalogue.ts";

describe("the catalogue", () => {
  it.effect("is the editor's primitives, whatever the repository holds", () =>
    Effect.gen(function* () {
      const catalogue = yield* (yield* CatalogueService).get(false);
      const names = catalogue.components.map((c) => c.name);
      assert.includeMembers(names, ["Button", "Dialog", "Select", "Menu"]);
      assert.isTrue(
        catalogue.components.every((c) => c.importFrom === PRIMITIVES_FROM)
      );
      const dialog = catalogue.components.find((c) => c.name === "Dialog");
      assert.deepStrictEqual(
        dialog?.slots?.filter((s) => s.holds !== undefined).map((s) => s.name),
        ["trigger", "dialog-header", "dialog-content", "dialog-footer"]
      );
    }).pipe(Effect.provide(CatalogueService.layer))
  );
});
