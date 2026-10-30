import path from "node:path";
import { assert, layer } from "@effect/vitest";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { tokenOf } from "@ultrapaint/contracts/token-table";
import { Effect, FileSystem } from "effect";
import { TestEnv, TestServer } from "./testing/harness.ts";

const THEME = `@theme {
  --color-brand: #2563eb;
  --radius-card: 0.75rem;
}
`;

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "the design system edited from the editor",
  (it) => {
    it.effect(
      "makes the operations in one undo step, which undo puts back, and the code follows when it is told to",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const css = path.join(repo, "styles/app.css");
          yield* fs.makeDirectory(path.join(repo, "styles"));
          yield* fs.writeFileString(css, THEME);
          yield* client["settings.set"]({
            ...settings,
            hostCss: ["../../styles/app.css"],
          });
          yield* client["designSystem.detect"]();
          const read = () =>
            Effect.map(
              client["designSystem.get"](),
              (s) => s.designSystem as DesignSystem
            );
          const before = yield* read();
          const group = before.colors[0]?.name ?? "";

          const { files } = yield* client["designSystem.edit"]({
            ops: [
              { name: "color-brand", op: "setValue", value: "#1d4ed8" },
              {
                description: "The brand's colour",
                name: "color-brand",
                op: "setDescription",
              },
              { group, name: "color-line", op: "addToken", value: "#e5e5e5" },
              { name: "radius-card", op: "removeToken" },
              { name: group, op: "renameGroup", to: "brand" },
              {
                op: "setTextStyle",
                style: { name: "Lead", role: "paragraph", size: 18 },
              },
            ],
          });
          assert.deepStrictEqual(files, [
            "designs/design-system.json",
            "designs/design.tokens.json",
          ]);
          const after = yield* read();
          assert.deepStrictEqual(tokenOf(after, "color-brand"), {
            description: "The brand's colour",
            name: "color-brand",
            value: "#1d4ed8",
          });
          assert.strictEqual(tokenOf(after, "color-line")?.value, "#e5e5e5");
          assert.isUndefined(tokenOf(after, "radius-card"));
          assert.strictEqual(after.colors[0]?.name, "brand");
          assert.include(
            after.typography.styles.map((s) => s.name),
            "Lead"
          );
          // The design leads: the code waits for an export.
          assert.include(yield* fs.readFileString(css), "#2563eb");

          // One step: undo puts every operation back.
          const undone = yield* client["edit.undo"]();
          assert.strictEqual(undone?.label, "Change the design system");
          const back = yield* read();
          assert.strictEqual(tokenOf(back, "color-brand")?.value, "#2563eb");
          assert.isUndefined(tokenOf(back, "color-line"));
          assert.strictEqual(tokenOf(back, "radius-card")?.value, "0.75rem");
          assert.strictEqual(back.colors[0]?.name, group);

          // An operation that does not fit refuses the whole list, and writes nothing.
          const refused = yield* Effect.flip(
            client["designSystem.edit"]({
              ops: [
                { name: "color-brand", op: "setValue", value: "#000000" },
                { name: "color-nope", op: "removeToken" },
              ],
            })
          );
          assert.include(String(refused.message), "removeToken color-nope");
          assert.strictEqual(
            tokenOf(yield* read(), "color-brand")?.value,
            "#2563eb"
          );

          // With codeTokens auto, a value reaches the code at once.
          const current = (yield* client["settings.get"]()) ?? settings;
          yield* client["settings.set"]({ ...current, codeTokens: "auto" });
          const auto = yield* client["designSystem.edit"]({
            label: "Round the cards more",
            ops: [{ name: "radius-card", op: "setValue", value: "1rem" }],
          });
          assert.include(auto.files, "styles/app.css");
          assert.include(yield* fs.readFileString(css), "--radius-card: 1rem;");
          const state = yield* client["edit.state"]();
          assert.strictEqual(state.undoLabel, "Round the cards more");
        }),
      30_000
    );
  }
);
