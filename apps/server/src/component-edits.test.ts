import { assert, layer } from "@effect/vitest";
import type { ComponentFile } from "@ultrapaint/contracts/components";
import { Effect } from "effect";
import { TestEnv, TestServer } from "./testing/harness.ts";

const OUTLINE_HOVER = {
  state: "hover" as const,
  variant: { axis: "variant", member: "outline" },
};

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "components edited from their boards (ADR 0045)",
  (it) => {
    it.effect(
      "sets one part's style at a place on the file as it is, in one undo step",
      () =>
        Effect.gen(function* () {
          const { client, settings } = yield* TestEnv;
          yield* client["settings.set"](settings);
          const read = () =>
            Effect.map(
              client["components.list"](),
              (l) =>
                l.components.find((e) => e.component?.name === "Button")
                  ?.component as ComponentFile
            );
          // Still in its default look: there is no file to set a style in.
          const refused = yield* Effect.flip(
            client["components.change"]({
              change: {
                op: "setStyle",
                place: OUTLINE_HOVER,
                slot: "root",
                style: { fill: "#ff0000" },
              },
              name: "Button",
            })
          );
          assert.include(refused.message, "take its look over first");

          yield* client["components.fromDefault"]({ name: "Button" });
          // A note added since the editor read the file stays: the style is set on it as it is.
          yield* client["components.change"]({
            change: { op: "addNote", text: "Submits its form" },
            name: "Button",
          });
          const before = yield* read();
          yield* client["components.change"]({
            change: {
              op: "setStyle",
              place: OUTLINE_HOVER,
              slot: "root",
              style: { fill: "#ff0000" },
            },
            name: "Button",
          });
          const after = yield* read();
          assert.strictEqual(after.origin, "system");
          if (after.origin !== "system" || before.origin !== "system") {
            return;
          }
          assert.deepStrictEqual(
            after.variantStates?.variant?.outline?.hover?.root,
            { fill: "#ff0000" }
          );
          assert.deepStrictEqual(after.base, before.base);
          assert.deepStrictEqual(after.variants, before.variants);
          assert.strictEqual(after.notes?.[0]?.text, "Submits its form");
          const state = yield* client["edit.state"]();
          assert.strictEqual(
            state.undoLabel,
            "Change Button's look at outline, hover"
          );

          // One step: undo puts the place back as it was.
          yield* client["edit.undo"]();
          const back = yield* read();
          assert.deepStrictEqual(back, before);

          // A part the component does not have is refused.
          const noPart = yield* Effect.flip(
            client["components.change"]({
              change: {
                op: "setStyle",
                place: { state: null, variant: null },
                slot: "nope",
                style: { fill: "red" },
              },
              name: "Button",
            })
          );
          assert.include(noPart.message, "Button has no part nope");
        }),
      30_000
    );

    it.effect(
      "makes a new app component, an empty column placed nowhere, in one undo step",
      () =>
        Effect.gen(function* () {
          const { client, settings } = yield* TestEnv;
          yield* client["settings.set"](settings);
          const made = yield* client["components.create"]({
            name: "Pricing card",
          });
          assert.strictEqual(
            made.file,
            "components/PricingCard.component.json"
          );
          const file = made.component;
          assert.strictEqual(file?.origin, "app");
          if (file?.origin !== "app") {
            return;
          }
          assert.strictEqual(file.tree.type, "column");
          assert.deepStrictEqual(
            "children" in file.tree ? file.tree.children : null,
            []
          );
          assert.deepStrictEqual(file.properties, []);
          const listed = yield* client["components.list"]();
          assert.include(
            listed.components.map((e) => e.component?.name),
            "PricingCard"
          );

          // A name taken, or a system component's, is refused.
          const again = yield* Effect.flip(
            client["components.create"]({ name: "PricingCard" })
          );
          assert.include(again.message, "there is a PricingCard component");
          const system = yield* Effect.flip(
            client["components.create"]({ name: "Button" })
          );
          assert.include(system.message, "a system component's name");

          const undone = yield* client["edit.undo"]();
          assert.strictEqual(undone?.label, "Make the PricingCard component");
          const gone = yield* client["components.list"]();
          assert.notInclude(
            gone.components.map((e) => e.component?.name),
            "PricingCard"
          );
        }),
      30_000
    );
  }
);
