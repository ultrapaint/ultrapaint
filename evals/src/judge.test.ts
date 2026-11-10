import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { judge, skillDirOf } from "./judge.ts";
import { type Asked, Models } from "./models.ts";
import { judgement, readData, TestData, writeData } from "./test-data.ts";

const ROUND = {
  agent: "claude-code",
  commit: "abc1234",
  host: "blank",
  name: "r",
  references: ["home"],
  runs: 1,
  skills: "built-in",
  startedAt: "2026-11-10T10:00:00.000Z",
};

/** A run of round `r` with a picture to judge, and its reference. */
const RUN = {
  "references/home/brief.md": "A home page.\n",
  "references/home/reference.json": {
    kind: "landing",
    name: "Home",
    why: "It is plain.",
  },
  "runs/r/home/run-1/run.json": {},
  "runs/r/home/run-1/shots/desktop-fold.jpg": "a picture",
};

/** What a finding may name, as the judge's answer is asked. */
const Offered = Schema.Struct({
  properties: Schema.Struct({
    findings: Schema.Struct({
      items: Schema.Struct({
        properties: Schema.Struct({
          skill: Schema.Struct({ enum: Schema.Array(Schema.String) }),
        }),
      }),
    }),
  }),
});

/** A round judged by a model that finds nothing, and what it was asked. */
const judged = () => {
  const asked: Asked[] = [];
  const offered = () =>
    Effect.map(
      Schema.decodeUnknownEffect(Offered)(asked[0]?.schema),
      (schema) => schema.properties.findings.items.properties.skill.enum
    );
  const run = judge("r", { concurrency: 1, force: false, model: "opus" }).pipe(
    Effect.provide(
      Models.layerTest((question) => {
        asked.push(question);
        return judgement({ overall: 3 });
      })
    )
  );
  return { asked, offered, run };
};

describe("the skill a round is judged against", () => {
  it.effect(
    "is the tree the round recorded: the judge is sent to it, and a finding names one of its files, the core first",
    () => {
      const { asked, offered, run } = judged();
      return Effect.gen(function* () {
        yield* writeData({
          ...RUN,
          "runs/r/round.json": {
            ...ROUND,
            skillTree: {
              dir: "skills/shipped",
              files: {
                "references/kinds/dialog.md": "1f",
                "references/states.md": "2e",
                "SKILL.md": "3d",
              },
            },
          },
        });
        yield* run;
        assert.include(asked[0]?.prompt, "in `runs/r/skills/shipped`.");
        assert.deepStrictEqual(yield* offered(), [
          "SKILL.md",
          "references/kinds/dialog.md",
          "references/states.md",
          "none",
        ]);
      }).pipe(Effect.provide(TestData));
    }
  );

  it.effect(
    "is, for a round from before that record, its skills one file each: a finding names a skill, as it did, and the run is judged",
    () => {
      const { asked, offered, run } = judged();
      return Effect.gen(function* () {
        yield* writeData({
          ...RUN,
          "runs/r/round.json": ROUND,
          "runs/r/skills/layout.md": "# Layout\n",
          "runs/r/skills/typography.md": "# Typography\n",
        });
        yield* run;
        assert.include(asked[0]?.prompt, "in `runs/r/skills`.");
        assert.deepStrictEqual(yield* offered(), [
          "layout",
          "typography",
          "none",
        ]);
        assert.include(
          yield* readData("runs/r/home/run-1/judge.json"),
          '"overall"'
        );
      }).pipe(Effect.provide(TestData));
    }
  );

  it.effect(
    "is, for a round that wrote its tree before recording it, that tree",
    () => {
      const { asked, offered, run } = judged();
      return Effect.gen(function* () {
        yield* writeData({
          ...RUN,
          "runs/r/round.json": ROUND,
          "runs/r/skills/shipped/README.md": "# About the skill\n",
          "runs/r/skills/shipped/references/states.md": "# States\n",
          "runs/r/skills/shipped/SKILL.md": "# The core\n",
        });
        yield* run;
        assert.include(asked[0]?.prompt, "in `runs/r/skills/shipped`.");
        assert.deepStrictEqual(yield* offered(), [
          "SKILL.md",
          "references/states.md",
          "none",
        ]);
      }).pipe(Effect.provide(TestData));
    }
  );

  it.effect(
    "is none for a round run with no skill, and the judge is told so",
    () => {
      const { asked, offered, run } = judged();
      return Effect.gen(function* () {
        yield* writeData({
          ...RUN,
          "runs/r/round.json": { ...ROUND, skills: "none" },
        });
        yield* run;
        assert.include(
          asked[0]?.prompt,
          "this round's agents were given no skill"
        );
        assert.deepStrictEqual(yield* offered(), ["none"]);
      }).pipe(Effect.provide(TestData));
    }
  );

  it.effect(
    "is where a study is set against it, and a round run with no skill has none to give",
    () =>
      Effect.gen(function* () {
        const { data } = yield* EvalsConfig;
        yield* writeData({
          "runs/none/round.json": { ...ROUND, name: "none", skills: "none" },
          "runs/r/round.json": {
            ...ROUND,
            skillTree: { dir: "skills/shipped", files: { "SKILL.md": "3d" } },
          },
        });
        assert.strictEqual(
          yield* skillDirOf("r"),
          `${data.runs}/r/skills/shipped`
        );
        assert.strictEqual(yield* skillDirOf("/a/skill"), "/a/skill");
        const refused = yield* Effect.flip(skillDirOf("none"));
        assert.include(refused.message, "round none recorded no skill");
      }).pipe(Effect.provide(TestData))
  );
});
