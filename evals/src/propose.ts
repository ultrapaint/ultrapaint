/**
 * `propose`: what a designer with the skill would do with each problem of a round's rating deck,
 * so the person says only whether that call is right, not whether each problem is real. Each
 * section's problems go to one model with the section's pictures, its code and the checkout's
 * skill to open, and it answers per problem: fix it (the change and the rule) or leave it (why).
 *
 * The calls are kept in `runs/<round>/<section>/proposals@<model>.json`, so a second call asks
 * nobody, and the deck `rate-<round>` is written again with each card's call: its `proposal`, and
 * `recommend` set to `real` for a fix and `noise` for a leave. The answers stay what they were,
 * real or noise, so recall and verify read them as before; a card's call is not its question, so
 * the answers given before it had one stay too.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { type Card, Deck, writeDeck } from "./decide.ts";
import { EvalsError } from "./errors.ts";
import { listDir, prompt, readJson, writeJson } from "./layout.ts";
import { Models } from "./models.ts";
import {
  rateDeckName,
  ratingId,
  Saved,
  Section,
  Unmatched,
  writeSkillTree,
} from "./recall.ts";

export const CALLS = ["fix", "leave"] as const;

export const Calls = Schema.Struct({
  calls: Schema.Array(
    Schema.Struct({
      call: Schema.Literals(CALLS),
      /** The problem's number in the list it was given, from 1. */
      n: Schema.Number,
      rule: Schema.String,
      what: Schema.String,
    })
  ),
});
export type Calls = typeof Calls.Type;

const callsAnswer = {
  decode: Calls,
  schema: {
    additionalProperties: false,
    properties: {
      calls: {
        items: {
          additionalProperties: false,
          properties: {
            call: { enum: [...CALLS], type: "string" },
            n: { type: "integer" },
            rule: { type: "string" },
            what: { type: "string" },
          },
          required: ["n", "call", "what", "rule"],
          type: "object",
        },
        type: "array",
      },
    },
    required: ["calls"],
    type: "object",
  },
};

/** What the deck's intro adds once its cards have calls. */
const CALLS_INTRO =
  "Each card shows what I would do with the problem by the skill: fix it, and how, or leave it. Say whether that call is right: Right keeps it, Wrong takes the other one. A comment goes with either.";

/** A call as the card shows it, in the deck's markdown. */
export const proposalText = (call: Calls["calls"][number]) =>
  [
    `**${call.call === "fix" ? "I'd fix it." : "I'd leave it."}** ${call.what.trim()}`,
    call.rule.trim()
      ? `The skill: ${call.rule.trim()}`
      : "No rule of the skill settles it.",
  ].join("\n\n");

/** The deck with each card that has a call showing it, and the option it stands for. */
export const withCalls = (
  deck: Deck,
  calls: ReadonlyMap<string, Calls["calls"][number]>
): Deck => ({
  ...deck,
  cards: deck.cards.map((card): Card => {
    const call = calls.get(card.id);
    return call === undefined
      ? card
      : {
          ...card,
          proposal: proposalText(call),
          recommend: call.call === "fix" ? "real" : "noise",
        };
  }),
  intro: deck.intro?.includes(CALLS_INTRO)
    ? deck.intro
    : `${deck.intro ?? ""}\n\n${CALLS_INTRO}`.trim(),
});

export const propose = Effect.fn("propose")(function* (options: {
  readonly concurrency: number;
  readonly effort: string;
  readonly model: string;
  readonly round: string;
}) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  const out = path.join(data.runs, options.round);
  const deckName = rateDeckName(options.round);
  const deckFile = path.join(data.root, "decisions", `${deckName}.json`);
  if (!(yield* fs.exists(deckFile))) {
    return yield* new EvalsError({
      message: `${options.round} has no rating deck: run its recall with --rate first`,
    });
  }
  const deck = yield* readJson(Deck, deckFile);
  const inDeck = new Set(deck.cards.map((c) => c.id));
  const skill = yield* writeSkillTree(
    path.join(out, "propose-skill"),
    "built-in"
  );

  const sections: {
    readonly id: string;
    readonly problems: (typeof Unmatched.Type)["problems"];
  }[] = [];
  for (const id of yield* listDir(out)) {
    const file = path.join(out, id, "unmatched.json");
    // The round's own files sit beside its sections.
    if (
      !(
        (yield* fs.exists(path.join(data.sections, id, "section.json"))) &&
        (yield* fs.exists(file))
      )
    ) {
      continue;
    }
    const problems = (yield* readJson(
      Saved(Unmatched),
      file
    )).value.problems.filter((p) => inDeck.has(ratingId(id, p.title)));
    if (problems.length > 0) {
      sections.push({ id, problems });
    }
  }

  const found = yield* Effect.forEach(
    sections,
    ({ id, problems }) =>
      Effect.gen(function* () {
        const file = path.join(
          out,
          id,
          `proposals@${options.model.replaceAll(/[^\w.-]/g, "-")}.json`
        );
        const answer = (yield* fs.exists(file))
          ? yield* readJson(Calls, file)
          : yield* Effect.gen(function* () {
              const section = yield* readJson(
                Section,
                path.join(data.sections, id, "section.json")
              );
              const asked = yield* models.ask({
                cwd: path.join(data.sections, id),
                dirs: [skill],
                effort: options.effort,
                images: section.pictures.map((p) => p.file),
                model: options.model,
                prompt: yield* prompt("propose-calls", {
                  code: section.code.map((f) => `- \`${f}\``).join("\n"),
                  name: section.name,
                  pictures: section.pictures
                    .map((p) => `- \`${p.file}\`: ${p.shows}`)
                    .join("\n"),
                  problems: problems
                    .map((p, i) => `${i + 1}. **${p.title}**: ${p.problem}`)
                    .join("\n"),
                  skill,
                  where: section.where,
                }),
                ...callsAnswer,
              });
              yield* writeJson(file, asked.value);
              yield* Effect.log(
                `${id}: ${asked.value.calls.filter((c) => c.call === "fix").length} of ${problems.length} to fix`
              );
              return asked.value;
            });
        return problems.flatMap((p, i) => {
          const call = answer.calls.find((c) => c.n === i + 1);
          return call === undefined
            ? []
            : [[ratingId(id, p.title), call] as const];
        });
      }).pipe(
        Effect.catchTag("EvalsError", (error) =>
          Effect.as(Effect.logWarning(`${id}: no calls: ${error.message}`), [])
        )
      ),
    { concurrency: options.concurrency }
  );
  const calls = new Map(found.flat());
  yield* writeDeck(deckName, withCalls(deck, calls));
  yield* Effect.log(
    `${calls.size} of ${deck.cards.length} cards have a call: pnpm evals decide ${deckName}`
  );
});
