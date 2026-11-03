/**
 * `learn`: what a person rewards, read off their picks. For every card where they picked the best
 * of several (a component, a section), a model is shown the winner beside the others, the
 * reference and their comment, and writes down what the winners do that the others do not, as
 * patterns, and those seen often as rules for the skills. The person's taste, made usable.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { Claude } from "./claude.ts";
import { roundSkills } from "./judge.ts";
import {
  DATA,
  fromData,
  PROMPTS,
  prompt,
  RUNS,
  writeJson,
  writeText,
} from "./layout.ts";
import { buildCards, NONE, readReview } from "./review.ts";

const Pattern = Schema.Struct({
  cards: Schema.Array(Schema.String),
  rule: Schema.String,
  skill: Schema.String,
  strength: Schema.Literals(["rule", "note"]),
  title: Schema.String,
});
const Learned = Schema.Struct({
  patterns: Schema.Array(Pattern),
  summary: Schema.String,
});

const learnedSchema = {
  additionalProperties: false,
  properties: {
    patterns: {
      items: {
        additionalProperties: false,
        properties: {
          cards: { items: { type: "string" }, type: "array" },
          rule: { type: "string" },
          skill: { type: "string" },
          strength: { enum: ["rule", "note"], type: "string" },
          title: { type: "string" },
        },
        required: ["title", "rule", "skill", "strength", "cards"],
        type: "object",
      },
      type: "array",
    },
    summary: { type: "string" },
  },
  required: ["patterns", "summary"],
  type: "object",
};

const LEADING_SLASH = /^\//;
/** A picture's path from the lab, as the viewer's URL names it. */
const fromUrl = (src: string) => src.replace(LEADING_SLASH, "");

export const learn = Effect.fn("learn")(function* (
  round: string,
  options: { readonly against?: string | undefined; readonly model: string }
) {
  const fs = yield* FileSystem.FileSystem;
  const claude = yield* Claude;
  const verdicts = yield* readReview(round);
  // A candidate round reviewed against an earlier one: its cards are built from both.
  const rounds = options.against
    ? [...options.against.split(","), round]
    : [round];
  const cards = new Map(
    (yield* buildCards(rounds)).map((card) => [card.id, card])
  );
  const choices = Object.entries(verdicts).flatMap(([id, v]) => {
    const card = cards.get(id);
    if (v.choice !== "picked" || !card?.options) {
      return [];
    }
    const winner = card.options.find((o) => o.id === v.pick);
    const others = card.options.filter((o) => o.id !== v.pick);
    return [
      [
        `- ${id}: ${card.question}`,
        `  picked: ${winner ? winner.pictures.map((p) => fromUrl(p.src)).join(", ") : NONE}`,
        `  others: ${others.flatMap((o) => o.pictures.map((p) => fromUrl(p.src))).join(", ")}`,
        `  reference: ${card.referencePictures.map((p) => fromUrl(p.src)).join(", ") || "none"}`,
        ...(v.comment ? [`  comment: ${v.comment}`] : []),
      ].join("\n"),
    ];
  });
  if (choices.length === 0) {
    return yield* Effect.logWarning(`${round}: no picks to learn from yet`);
  }
  const answer = yield* claude.ask({
    cwd: DATA,
    model: options.model,
    prompt: yield* prompt("learn", {
      choices: choices.join("\n"),
      principles: yield* fs.readFileString(path.join(PROMPTS, "principles.md")),
      skills: (yield* roundSkills(round)).join(", ") || "the design skills",
    }),
    schema: learnedSchema,
  });
  const learned = yield* Schema.decodeUnknownEffect(Learned)(answer.structured);
  const dir = path.join(RUNS, round);
  yield* writeJson(path.join(dir, "learned.json"), learned);
  const rules = learned.patterns.filter((p) => p.strength === "rule");
  const notes = learned.patterns.filter((p) => p.strength === "note");
  yield* writeText(
    path.join(dir, "learned.md"),
    [
      `# What the picks of ${round} say`,
      "",
      `From ${choices.length} picks ($${answer.costUsd.toFixed(2)}).`,
      "",
      learned.summary,
      "",
      "## Rules (seen three times or more)",
      "",
      ...rules.flatMap((p) => [
        `### ${p.title}`,
        "",
        `${p.rule}`,
        "",
        `Skill: ${p.skill}. Seen in: ${p.cards.join(", ")}`,
        "",
      ]),
      "## Notes",
      "",
      ...notes.map((p) => `- **${p.title}** (${p.skill}): ${p.rule}`),
      "",
    ].join("\n")
  );
  yield* Effect.log(`learned: ${fromData(path.join(dir, "learned.md"))}`);
});
