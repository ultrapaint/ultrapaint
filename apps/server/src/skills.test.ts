import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { TestEnv, TestServer, waitForThread } from "./testing/harness.ts";
import { turnEnded } from "./testing/turns.ts";

const FRONT_MATTER_RE = /^---\nextends: true\n---\n/;
const EXTENDED_COLOUR_RE =
  /semantic tokens[\s\S]*Blue is the brand; never use it for status\.\n$/;

const SHIPPED = [
  "hierarchy",
  "layout",
  "spacing",
  "typography",
  "color",
  "elevation",
  "borders",
  "iconography",
  "motion",
  "content",
  "states",
  "components",
  "accessibility",
];

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "design skills",
  (it) => {
    it.effect(
      "ships a set, which the project's files replace or extend and the settings turn off",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* client["settings.set"](settings);

          const shipped = yield* client["skills.list"]();
          assert.strictEqual(shipped.dir, "designs/skills");
          assert.deepStrictEqual(
            shipped.skills.map((s) => [s.name, s.source, s.enabled]),
            SHIPPED.map((name) => [name, "built-in", true])
          );
          const [first] = shipped.skills;
          assert.strictEqual(first?.title, "Hierarchy");
          assert.include(first?.summary, "one thing it is for");
          assert.isUndefined(first?.file);

          const dir = path.join(repo, "designs", "skills");
          yield* fs.makeDirectory(dir, { recursive: true });
          yield* fs.writeFileString(
            path.join(dir, "spacing.md"),
            "# Our spacing\n\nEight pixels, everywhere.\n"
          );
          yield* fs.writeFileString(
            path.join(dir, "brand.md"),
            "# Brand\n\nThe logo never sits on a photograph.\n"
          );
          yield* fs.writeFileString(
            path.join(dir, "color.md"),
            "---\nextends: true\n---\nBlue is the brand; never use it for status.\n"
          );
          const own = yield* client["skills.list"]();
          const sources: Record<string, string> = {
            color: "project",
            spacing: "project",
          };
          assert.deepStrictEqual(
            own.skills.map((s) => [s.name, s.source, s.extends]),
            [
              ...SHIPPED.map((name) => [
                name,
                sources[name] ?? "built-in",
                name === "color",
              ]),
              ["brand", "project", false],
            ]
          );
          // A file of a built-in's name replaces it...
          const spacing = own.skills.find((s) => s.name === "spacing");
          assert.strictEqual(spacing?.title, "Our spacing");
          assert.strictEqual(spacing?.summary, "Eight pixels, everywhere.");
          assert.strictEqual(spacing?.file, "designs/skills/spacing.md");
          assert.notInclude(spacing?.text, "semantic tokens");
          // ...unless it says it extends it: then it follows the built-in's text.
          const colour = own.skills.find((s) => s.name === "color");
          assert.strictEqual(colour?.title, "Colour");
          assert.include(colour?.text, "semantic tokens");
          assert.match(colour?.text ?? "", EXTENDED_COLOUR_RE);
          assert.notInclude(colour?.text, "extends: true");

          yield* client["settings.set"]({
            ...settings,
            skills: { disabled: ["color", "brand"] },
          });
          const off = yield* client["skills.list"]();
          assert.deepStrictEqual(
            off.skills.filter((s) => !s.enabled).map((s) => s.name),
            ["color", "brand"]
          );
        }),
      30_000
    );

    it.effect(
      "copies a built-in skill into the project, as one undo step",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          yield* client["settings.set"](settings);

          const copied = yield* client["skills.customise"]({
            mode: "replace",
            name: "typography",
          });
          assert.strictEqual(copied.source, "project");
          assert.isFalse(copied.extends);
          assert.strictEqual(copied.file, "designs/skills/typography.md");
          const text = yield* fs.readFileString(
            `${repo}/designs/skills/typography.md`
          );
          assert.strictEqual(text, copied.text);
          assert.include(text, "# Typography");

          // Again is a no-op: the project's file is what there is to edit.
          const again = yield* client["skills.customise"]({
            mode: "extend",
            name: "typography",
          });
          assert.deepStrictEqual(again, copied);

          // The first test left a spacing file behind: this one extends a built-in still shipped.
          const extended = yield* client["skills.customise"]({
            mode: "extend",
            name: "hierarchy",
          });
          assert.isTrue(extended.extends);
          assert.strictEqual(extended.title, "Hierarchy");
          const stub = yield* fs.readFileString(
            `${repo}/designs/skills/hierarchy.md`
          );
          assert.match(stub, FRONT_MATTER_RE);
          assert.include(extended.text, "Every screen has one thing it is for");
          assert.include(extended.text, "In this product, also");

          const unknown = yield* Effect.flip(
            client["skills.customise"]({ mode: "replace", name: "nothing" })
          );
          assert.strictEqual(unknown._tag, "NotFound");

          // Each copy is one undo step.
          yield* client["edit.undo"]();
          assert.isFalse(
            yield* fs.exists(`${repo}/designs/skills/hierarchy.md`)
          );

          yield* client["edit.undo"]();
          assert.isFalse(
            yield* fs.exists(`${repo}/designs/skills/typography.md`)
          );
          const after = yield* client["skills.list"]();
          assert.strictEqual(
            after.skills.find((s) => s.name === "typography")?.source,
            "built-in"
          );
        })
    );

    it.effect(
      "tells the agent the skills that are on, before the project's conventions",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(
            `${repo}/DESIGN.md`,
            "## Colors\n\nBlue is the brand.\n"
          );
          yield* client["settings.set"]({
            ...settings,
            skills: { disabled: ["color"] },
          });
          const thread = yield* client["threads.create"]({ agentId: "fake" });
          yield* client["threads.prompt"]({
            attachments: [],
            text: "briefing",
            threadId: thread.id,
          });
          const { items } = yield* waitForThread(thread.id, turnEnded);
          const told = items
            .flatMap((i) => (i.kind === "agent" ? [i.text] : []))
            .join("\n");
          assert.include(told, "# Hierarchy");
          assert.include(told, "# Components");
          assert.notInclude(told, "# Colour");
          assert.isBelow(
            told.indexOf("# Hierarchy"),
            told.indexOf("Blue is the brand.")
          );
        }),
      30_000
    );
  }
);
