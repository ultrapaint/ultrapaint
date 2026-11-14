import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { ProjectBriefing, SKILLS_OFF } from "./services/threads/briefing.ts";
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
    "ships the design skill on, lists the project's skill folders off, never reads the designs directory, and the settings turn each on or off",
    () =>
      Effect.gen(function* () {
        const { client, repo, settings } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const shipped = yield* client["skills.list"]();
        assert.deepStrictEqual(shipped.installed, []);
        assert.deepStrictEqual(
          shipped.skills.map((s) => [s.name, s.source, s.enabled]),
          [["ultrapaint", "built-in", true]]
        );
        const [design] = shipped.skills;
        assert.strictEqual(design?.title, "Ultrapaint");
        assert.include(design?.summary ?? "", "Interface design rules");
        assert.isUndefined(design?.file);

        // The designs directory holds designs only: a markdown file there is no skill.
        const designs = path.join(repo, "designs", "skills");
        yield* fs.makeDirectory(designs, { recursive: true });
        yield* fs.writeFileString(
          path.join(designs, "brand.md"),
          "# Brand\n\nThe logo never sits on a photograph.\n"
        );
        // An agent's skill folder, two of one name, and a copy of the design skill, left out.
        const grilling = path.join(repo, ".claude", "skills", "grilling");
        yield* fs.makeDirectory(grilling, { recursive: true });
        yield* fs.writeFileString(
          path.join(grilling, "SKILL.md"),
          "---\nname: grilling\ndescription: >\n  Grill the user about a plan,\n  relentlessly.\n---\n\n# Grilling\n\nAsk one question at a time.\n"
        );
        const voice = path.join(repo, "skills", "grilling");
        yield* fs.makeDirectory(voice, { recursive: true });
        yield* fs.writeFileString(
          path.join(voice, "SKILL.md"),
          "# Voice\n\nPlain words.\n"
        );
        const copy = path.join(repo, ".agents", "skills", "ultrapaint");
        yield* fs.makeDirectory(copy, { recursive: true });
        yield* fs.writeFileString(
          path.join(copy, "SKILL.md"),
          "# Ultrapaint\n"
        );
        const own = yield* client["skills.list"]();
        assert.deepStrictEqual(own.installed, [".agents/skills/ultrapaint"]);
        assert.deepStrictEqual(
          own.skills.map((s) => [s.name, s.source, s.file, s.enabled]),
          [
            ["ultrapaint", "built-in", undefined, true],
            ["grilling", "project", ".claude/skills/grilling/SKILL.md", false],
            ["grilling-2", "project", "skills/grilling/SKILL.md", false],
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

        yield* client["settings.set"]({
          ...settings,
          skills: {
            disabled: ["ultrapaint"],
            enabled: ["skills/grilling/SKILL.md"],
          },
        });
        const chosen = yield* client["skills.list"]();
        assert.deepStrictEqual(
          chosen.skills.filter((s) => s.enabled).map((s) => s.name),
          ["grilling-2"]
        );
      })
  );

  inProject.effect(
    "lists a skill linked into another agent's folder once, by the folder listed first",
    () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        // A skills pack installed once in `.agents/skills`, linked into Claude Code's folder.
        const ship = path.join(repo, ".agents", "skills", "up-ship");
        yield* fs.makeDirectory(ship, { recursive: true });
        yield* fs.writeFileString(
          path.join(ship, "SKILL.md"),
          "---\nname: up-ship\ndescription: Takes a PR to merged.\n---\n\n# Ship\n"
        );
        yield* fs.makeDirectory(path.join(repo, ".claude", "skills"), {
          recursive: true,
        });
        yield* fs.symlink(
          "../../.agents/skills/up-ship",
          path.join(repo, ".claude", "skills", "up-ship")
        );
        const { skills } = yield* client["skills.list"]();
        assert.deepStrictEqual(
          skills.map((s) => [s.name, s.file]),
          [
            ["ultrapaint", undefined],
            ["up-ship", ".claude/skills/up-ship/SKILL.md"],
          ]
        );
      })
  );

  inProject.effect(
    "saves the design skill into the repository for agents outside the tool, whole and replaced",
    () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const at = path.join(repo, ".claude", "skills", "ultrapaint");
        // An older copy's file that the skill no longer has goes.
        yield* fs.makeDirectory(at, { recursive: true });
        yield* fs.writeFileString(path.join(at, "old.md"), "gone\n");
        assert.strictEqual(
          yield* client["skills.install"]({ into: ".claude/skills" }),
          ".claude/skills/ultrapaint"
        );
        assert.isFalse(yield* fs.exists(path.join(at, "old.md")));
        const core = yield* fs.readFileString(path.join(at, "SKILL.md"));
        assert.isTrue(core.startsWith("---\nname: ultrapaint\ndescription: "));
        assert.include(core, "\n# Ultrapaint\n");
        // The core names its references beside it, as the source does.
        assert.include(core, "`references/");
        for (const file of referenceFiles) {
          assert.strictEqual(
            yield* fs.readFileString(path.join(at, file)),
            skillFiles[file]
          );
        }
        assert.deepStrictEqual((yield* client["skills.list"]()).installed, [
          ".claude/skills/ultrapaint",
        ]);
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
            files: {
              ".claude/skills/voice/SKILL.md": "# Voice\n\nPlain words.\n",
            },
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
            files: {
              ".claude/skills/voice/SKILL.md": "# Voice\n\nPlain words.\n",
            },
            settings: {
              skills: {
                disabled: ["ultrapaint"],
                enabled: [".claude/skills/voice/SKILL.md"],
              },
            },
          })
        ),
        Effect.scoped
      )
  );

  /** A project with a skill of its own, which its settings leave off. */
  const withVoice = ProjectTest({
    files: { ".claude/skills/voice/SKILL.md": "# Voice\n\nPlain words.\n" },
  });

  /** The briefing a design thread is told for the chat's choice of skills. */
  const toldFor = (skills: readonly string[]) =>
    Effect.flatMap(ProjectBriefing, (briefing) =>
      briefing.text("design", { skills, tools: true })
    ).pipe(Effect.map((text) => text ?? ""));

  it.effect(
    "tells a chat exactly the skills it chose, whatever the settings turn on, and none when it chose none",
    () =>
      Effect.gen(function* () {
        const none = yield* toldFor([]);
        assert.notInclude(none, "How to design well");
        assert.notInclude(none, "How you work in this chat");
        assert.notInclude(none, "# Ultrapaint");

        const design = yield* toldFor(["ultrapaint"]);
        assert.include(design, "\n# Ultrapaint\n");
        assert.include(design, "The design skill in this tool");
        assert.notInclude(design, "Plain words.");

        // A name that matches no skill is passed over.
        const own = yield* toldFor([
          ".claude/skills/voice/SKILL.md",
          "gone.md",
        ]);
        assert.include(own, "# Voice\n\nPlain words.");
        assert.include(own, "How you work in this chat");
        assert.notInclude(own, "# Ultrapaint");
        assert.notInclude(own, "The design skill in this tool");
        const briefing = yield* ProjectBriefing;
        assert.deepStrictEqual(
          yield* briefing.told([".claude/skills/voice/SKILL.md", "gone.md"]),
          [".claude/skills/voice/SKILL.md"]
        );
        assert.deepStrictEqual(yield* briefing.told(undefined), ["ultrapaint"]);
      }).pipe(Effect.provide(withVoice), Effect.scoped)
  );

  it.effect(
    "tells a chat whose skills changed the ones it chose now, or to stop following any",
    () =>
      Effect.gen(function* () {
        const briefing = yield* ProjectBriefing;
        const options = { method: false, reviewed: true, tools: true };
        assert.strictEqual(yield* briefing.changed([], options), SKILLS_OFF);

        const own =
          (yield* briefing.changed(
            [".claude/skills/voice/SKILL.md"],
            options
          )) ?? "";
        assert.include(own, "The user changed this chat's design skills");
        assert.include(own, "# Voice\n\nPlain words.");
        assert.notInclude(own, "# Ultrapaint");
        assert.notInclude(own, "How you work in this chat");

        // One briefed with none is told how to work in the chat too.
        const first =
          (yield* briefing.changed(["ultrapaint"], {
            ...options,
            method: true,
          })) ?? "";
        assert.include(first, "How you work in this chat");
        assert.include(first, "\n# Ultrapaint\n");
        assert.include(first, "The design skill in this tool");
      }).pipe(Effect.provide(withVoice), Effect.scoped)
  );

  inProject.effect(
    "keeps a chat's own choice of skills on the thread, and null goes back to the project's",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        // The first agent there is: none is started until a prompt.
        const { id: threadId } = yield* client["threads.create"]({});
        const skillsOf = Effect.map(
          client["threads.list"](),
          (threads) => threads.find((t) => t.id === threadId)?.skills
        );
        yield* client["threads.setSkills"]({ skills: [], threadId });
        assert.deepStrictEqual(yield* skillsOf, []);
        yield* client["threads.setSkills"]({
          skills: ["ultrapaint", ".claude/skills/voice/SKILL.md"],
          threadId,
        });
        assert.deepStrictEqual(yield* skillsOf, [
          "ultrapaint",
          ".claude/skills/voice/SKILL.md",
        ]);
        yield* client["threads.setSkills"]({ skills: null, threadId });
        assert.isUndefined(yield* skillsOf);
        const unknown = yield* Effect.flip(
          client["threads.setSkills"]({ skills: [], threadId: "t_gone" })
        );
        assert.strictEqual(unknown._tag, "NotFound");
      })
  );
});
