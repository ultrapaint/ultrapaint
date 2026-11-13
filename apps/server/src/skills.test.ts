import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { ProjectBriefing } from "./services/threads/briefing.ts";
import { CORE_FILE, referenceFiles, skillFiles } from "./skills/index.ts";
import { perTest } from "./testing/each-test.ts";
import { TestEnv } from "./testing/harness.ts";
import { ProjectFixture, ProjectRpc, ProjectTest } from "./testing/project.ts";

/** A file a text names by its absolute path: `` `/home/…/references/layout.md` ``. */
const MENTIONED_RE = /`(\/[^`]+\.md)`/g;

/** Each test on a project of its own, its requests in-process (docs/TESTING.md rules 1 and 3). */
const inProject = perTest(ProjectRpc());

/** The briefing a design thread with the editor's tools is told. */
const told = Effect.flatMap(ProjectBriefing, (briefing) =>
  briefing.text("design", { tools: true })
).pipe(Effect.map((text) => text ?? ""));

/** Every file a text names by its path, and whether each is on disk. */
const namedFiles = Effect.fnUntraced(function* (text: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* Effect.forEach(
    [...new Set([...text.matchAll(MENTIONED_RE)].map((m) => m[1] ?? ""))],
    (file) => Effect.map(fs.exists(file), (there) => ({ file, there }))
  );
});

describe("design skills", () => {
  inProject.effect(
    "ships the design skill on, lists the project's own skills off, and the settings turn each on or off",
    () =>
      Effect.gen(function* () {
        const { client, repo, settings } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const shipped = yield* client["skills.list"]();
        assert.strictEqual(shipped.dir, "designs/skills");
        assert.deepStrictEqual(
          shipped.skills.map((s) => [s.name, s.source, s.enabled]),
          [["ultrapaint", "built-in", true]]
        );
        const [design] = shipped.skills;
        assert.strictEqual(design?.title, "Ultrapaint");
        assert.isNotEmpty(design?.summary);
        assert.isUndefined(design?.file);

        const dir = path.join(repo, "designs", "skills");
        yield* fs.makeDirectory(dir, { recursive: true });
        yield* fs.writeFileString(
          path.join(dir, "brand.md"),
          "# Brand\n\nThe logo never sits on a photograph.\n"
        );
        // A file that once extended a part of the skill is a skill of its own, told as written.
        yield* fs.writeFileString(
          path.join(dir, "color.md"),
          "---\nextends: true\n---\nBlue is the brand; never use it for status.\n"
        );
        // An agent's skill folder, and a copy of the design skill, which is left out.
        const grilling = path.join(repo, ".claude", "skills", "grilling");
        yield* fs.makeDirectory(grilling, { recursive: true });
        yield* fs.writeFileString(
          path.join(grilling, "SKILL.md"),
          "---\nname: grilling\ndescription: >\n  Grill the user about a plan,\n  relentlessly.\n---\n\n# Grilling\n\nAsk one question at a time.\n"
        );
        const copy = path.join(repo, ".agents", "skills", "ultrapaint");
        yield* fs.makeDirectory(copy, { recursive: true });
        yield* fs.writeFileString(
          path.join(copy, "SKILL.md"),
          "# Ultrapaint\n"
        );
        const own = yield* client["skills.list"]();
        assert.deepStrictEqual(
          own.skills.map((s) => [s.name, s.source, s.file, s.enabled]),
          [
            ["ultrapaint", "built-in", undefined, true],
            ["brand", "project", "designs/skills/brand.md", false],
            ["color", "project", "designs/skills/color.md", false],
            ["grilling", "project", ".claude/skills/grilling/SKILL.md", false],
          ]
        );
        const folder = own.skills.find((s) => s.name === "grilling");
        assert.strictEqual(folder?.title, "grilling");
        assert.strictEqual(
          folder?.summary,
          "Grill the user about a plan, relentlessly."
        );
        assert.isTrue(
          folder?.text.startsWith(
            "The skill’s files are in `.claude/skills/grilling/`"
          )
        );
        const colour = own.skills.find((s) => s.name === "color");
        assert.strictEqual(
          colour?.text,
          "Blue is the brand; never use it for status.\n"
        );

        yield* client["settings.set"]({
          ...settings,
          skills: {
            disabled: ["ultrapaint"],
            enabled: [
              "designs/skills/brand.md",
              ".claude/skills/grilling/SKILL.md",
            ],
          },
        });
        const chosen = yield* client["skills.list"]();
        assert.deepStrictEqual(
          chosen.skills.filter((s) => s.enabled).map((s) => s.name),
          ["brand", "grilling"]
        );
      })
  );

  it.effect(
    "tells the core by default and no reference, before the project's conventions",
    () =>
      Effect.gen(function* () {
        const text = yield* told;
        assert.include(text, "\n# Ultrapaint\n");
        for (const file of referenceFiles) {
          assert.notInclude(text, (skillFiles[file] ?? "").trim(), file);
        }
        assert.isBelow(
          text.indexOf("# Ultrapaint"),
          text.indexOf("Blue is the brand.")
        );
      }).pipe(
        Effect.provide(
          ProjectTest({
            files: { "DESIGN.md": "## Colors\n\nBlue is the brand.\n" },
          })
        ),
        Effect.scoped
      )
  );

  it.effect(
    "names every file of the skill it tells where it is written, and each file there names the others where they are",
    () =>
      Effect.gen(function* () {
        const text = yield* told;
        const { home } = yield* ProjectFixture;
        const fs = yield* FileSystem.FileSystem;
        assert.notInclude(text, "`references/");
        const named = yield* namedFiles(text);
        assert.isNotEmpty(named);
        for (const { file, there } of named) {
          assert.isTrue(file.startsWith(`${home}/.cache/ultrapaint/`), file);
          assert.isTrue(there, `${file} is not there`);
        }
        // A file read there reads as the briefing does.
        const [first] = named;
        const cached = first?.file.slice(0, first.file.indexOf("/references/"));
        const written = [CORE_FILE, ...referenceFiles];
        for (const file of written) {
          const there = yield* fs.readFileString(`${cached}/${file}`);
          assert.notInclude(there, "`references/", file);
          for (const mention of yield* namedFiles(there)) {
            assert.isTrue(mention.there, `${file} names ${mention.file}`);
          }
        }
      }).pipe(Effect.provide(ProjectTest()), Effect.scoped)
  );

  it.effect("tells every reference whole too when the settings say full", () =>
    Effect.gen(function* () {
      const text = yield* told;
      assert.include(text, "\n# Ultrapaint\n");
      for (const file of referenceFiles) {
        // Each as written but for where it names the others.
        const [heading] = (skillFiles[file] ?? "").trim().split("\n");
        assert.include(text, `/${file}\`:\n\n${heading}`, file);
      }
    }).pipe(
      Effect.provide(
        ProjectTest({ settings: { skills: { briefing: "full" } } })
      ),
      Effect.scoped
    )
  );

  it.effect(
    "tells none of the project's own skills the settings leave off",
    () =>
      Effect.gen(function* () {
        const text = yield* told;
        assert.include(text, "\n# Ultrapaint\n");
        assert.notInclude(text, "Plain words.");
      }).pipe(
        Effect.provide(
          ProjectTest({
            files: { "designs/skills/voice.md": "# Voice\n\nPlain words.\n" },
          })
        ),
        Effect.scoped
      )
  );

  it.effect(
    "tells none of the design skill when the settings turn it off, and the project's own turned on",
    () =>
      Effect.gen(function* () {
        const text = yield* told;
        assert.notInclude(text, "# Ultrapaint");
        assert.notInclude(text, "The design skill in this tool");
        assert.include(text, "# Voice\n\nPlain words.");
      }).pipe(
        Effect.provide(
          ProjectTest({
            files: { "designs/skills/voice.md": "# Voice\n\nPlain words.\n" },
            settings: {
              skills: {
                disabled: ["ultrapaint"],
                enabled: ["designs/skills/voice.md"],
              },
            },
          })
        ),
        Effect.scoped
      )
  );
});
