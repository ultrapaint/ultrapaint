import { assert, describe } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { perTest } from "./testing/each-test.ts";
import { TestEnv, TestServer, waitForThread } from "./testing/harness.ts";
import { ProjectRpc } from "./testing/project.ts";
import { turnEnded } from "./testing/turns.ts";

const FRONT_MATTER_RE = /^---\nextends: true\n---\n/;
const REFERENCES_DIR_RE = /The references are in `([^`]+)\/`/;
const EXTENDED_COLOUR_RE =
  /semantic tokens[\s\S]*Blue is the brand; never use it for status\.\n$/;

const SHIPPED = [
  "character",
  "hierarchy",
  "restraint",
  "layout",
  "patterns",
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
  "design-system",
  "picture",
  "accessibility",
];

/** Each test on a project of its own, its requests in-process (docs/TESTING.md rules 1 and 3). */
const inProject = perTest(ProjectRpc());

/** What an agent is told, by an agent that is a real process the server starts. */
const onAServer = perTest(TestServer, {
  realClock: "the agent is a real process, its turn heard over the socket",
});

describe("design skills", () => {
  inProject.effect(
    "ships a set, which the project's files replace or extend and the settings turn off",
    () =>
      Effect.gen(function* () {
        const { client, repo, settings } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const shipped = yield* client["skills.list"]();
        assert.strictEqual(shipped.dir, "designs/skills");
        assert.deepStrictEqual(
          shipped.skills.map((s) => [s.name, s.source, s.enabled]),
          SHIPPED.map((name) => [name, "built-in", true])
        );
        const [first] = shipped.skills;
        assert.strictEqual(first?.title, "Character");
        assert.include(first?.summary, "Every product has a character");
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
      })
  );

  inProject.effect(
    "copies a built-in skill into the project, as one undo step",
    () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;

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

        // A built-in extended: the project's file says so, and the built-in's text follows.
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
        assert.isFalse(yield* fs.exists(`${repo}/designs/skills/hierarchy.md`));

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

  onAServer.effect(
    "tells the agent the skills that are on, before the project's conventions",
    () =>
      Effect.gen(function* () {
        const { client, home, repo, settings } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
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

        // The patterns' references are named where they are written, outside the project.
        // Typed by hand: the linter otherwise takes the match for non-null.
        const found: RegExpExecArray | null = REFERENCES_DIR_RE.exec(told);
        const named = found?.[1] ?? "";
        assert.isTrue(
          named.startsWith(path.join(home, ".cache", "ultrapaint"))
        );
        assert.include(
          yield* fs.readFileString(path.join(named, "dialogs.md")),
          "# Dialogs"
        );
      }),
    30_000
  );
});
