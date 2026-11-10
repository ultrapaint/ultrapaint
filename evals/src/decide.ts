/**
 * `decide`: the decisions an agent needs from the person, one card at a time in the browser, each
 * answered by a key with a comment when there is something to say. An agent writes the deck,
 * `decisions/<deck>.json` in the data directory; the answers go in `decisions/<deck>.answers.json`
 * as they are given, so the person can stop and go on, and the agent reads them back.
 *
 * The page is `evals/viewers/decide.html`; the pictures a card shows are files of the data
 * directory, named by their path from it.
 */
import { createServer } from "node:http";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { NodeHttpServer } from "@effect/platform-node";
import { DateTime, Effect, FileSystem, Layer, Schema, Semaphore } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";
import { EvalsConfig } from "./config.ts";
import { readJson, viewerPage, writeJson } from "./layout.ts";

export const Option = Schema.Struct({
  /** What the answer is saved as. */
  key: Schema.String,
  label: Schema.String,
  /** What choosing it leads to, in a line. */
  leads: Schema.optional(Schema.String),
});

/** A box drawn on a picture, in fractions of its width and height, with what it points at. */
export const Mark = Schema.Struct({
  /** Where its label goes: above by default, inside when the box is at the picture's top. */
  at: Schema.optional(Schema.Literals(["above", "below", "right", "inside"])),
  height: Schema.Number,
  label: Schema.optional(Schema.String),
  width: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
});

export const Picture = Schema.Struct({
  caption: Schema.String,
  marks: Schema.optional(Schema.Array(Mark)),
  /** Its path from the data directory. */
  src: Schema.String,
});

export const Card = Schema.Struct({
  /** What the card is about, in markdown: paragraphs, `- ` lists, **bold**, `code`. */
  body: Schema.optional(Schema.String),
  /** A small label above the title: the gap, the section, the step. */
  eyebrow: Schema.optional(Schema.String),
  id: Schema.String,
  options: Schema.Array(Option),
  /**
   * Pictures from the data directory, each with what it shows and boxes around what the card
   * asks about: a close-up of the item reads faster than a whole screen.
   */
  pictures: Schema.optional(Schema.Array(Picture)),
  /** The option the agent recommends, by its key. */
  recommend: Schema.optional(Schema.String),
  title: Schema.String,
});
export type Card = typeof Card.Type;

export const Deck = Schema.Struct({
  cards: Schema.Array(Card),
  /** What the decisions are for, shown before the first card. */
  intro: Schema.optional(Schema.String),
  title: Schema.String,
});
export type Deck = typeof Deck.Type;

export const Answer = Schema.Struct({
  at: Schema.String,
  /** The option chosen; none when the person answered in their own words, the comment. */
  choice: Schema.optional(Schema.String),
  comment: Schema.optional(Schema.String),
  /** The option's label, or `OWN_ANSWER`, so the file reads without the deck. */
  label: Schema.String,
  title: Schema.String,
});

/** The label of an answer given in the person's own words, with no option chosen. */
export const OWN_ANSWER = "Own answer";
/** A deck's answers as they are saved, by card. */
export const Answers = Schema.Record(Schema.String, Answer);

const AnswerInput = Schema.Struct({
  choice: Schema.optional(Schema.String),
  comment: Schema.optional(Schema.String),
  id: Schema.String,
});

/**
 * An answer to a card, or why it isn't one: one of the card's options, with a comment or not, or
 * the person's own words alone, as an agent's question takes an answer none of its options gave.
 */
export const answerTo = (
  card: Card,
  input: {
    readonly choice?: string | undefined;
    readonly comment?: string | undefined;
  },
  at: string
): typeof Answer.Type | string => {
  const comment = input.comment?.trim();
  if (input.choice === undefined) {
    return comment
      ? { at, comment, label: OWN_ANSWER, title: card.title }
      : `${card.id}: an answer needs an option or words of its own`;
  }
  const option = card.options.find((o) => o.key === input.choice);
  if (option === undefined) {
    return `${card.id} has no option ${input.choice}`;
  }
  return {
    at,
    choice: option.key,
    ...(comment ? { comment } : {}),
    label: option.label,
    title: card.title,
  };
};

/** A card as its file holds it: what an answer was given to. */
const asWritten = (card: Card): unknown => JSON.parse(JSON.stringify(card));

/** The answers as any writer left them: read whole, so setting them aside loses none. */
const AnswersAsWritten = Schema.Record(Schema.String, Schema.Unknown);

/** A file that is not there yet: the name, or the name with the first number that is free. */
const freeFile = Effect.fnUntraced(function* (dir: string, name: string) {
  const fs = yield* FileSystem.FileSystem;
  let file = path.join(dir, `${name}.json`);
  for (let n = 2; yield* fs.exists(file); n += 1) {
    file = path.join(dir, `${name}-${n}.json`);
  }
  return file;
});

/**
 * A deck written by the command that makes it. An answer was given to a card as it read: it stays
 * while the deck still has that card, word for word, so a command run again on the same data
 * keeps what was answered. Once a card reads otherwise or is gone, its id may name another
 * question, so the answers file is first copied whole beside itself under the time
 * (`<deck>.answers.<time>.json`) and those answers leave the one `decide` and the command read.
 * It gives the file the answers were set aside in, when some were.
 */
export const writeDeck = Effect.fn("writeDeck")(function* (
  deckName: string,
  deck: Deck
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const dir = path.join(data.root, "decisions");
  const deckFile = path.join(dir, `${deckName}.json`);
  const answersFile = path.join(dir, `${deckName}.answers.json`);
  let aside: string | undefined;
  if (yield* fs.exists(answersFile)) {
    const answers = yield* readJson(AnswersAsWritten, answersFile);
    // A deck that no longer reads says nothing of what its answers were given to.
    const before: readonly Card[] = (yield* fs.exists(deckFile))
      ? yield* readJson(Deck, deckFile).pipe(
          Effect.map((d) => d.cards),
          Effect.catchTag("EvalsError", () => Effect.succeed([]))
        )
      : [];
    const was = new Map(before.map((c) => [c.id, asWritten(c)]));
    const stands = new Set(
      deck.cards
        .filter((c) => was.has(c.id))
        .filter((c) => isDeepStrictEqual(was.get(c.id), asWritten(c)))
        .map((c) => c.id)
    );
    const kept = Object.entries(answers).filter(([id]) => stands.has(id));
    if (kept.length < Object.keys(answers).length) {
      const at = DateTime.formatIso(yield* DateTime.now).replaceAll(":", "-");
      aside = yield* freeFile(dir, `${deckName}.answers.${at}`);
      yield* fs.copyFile(answersFile, aside);
      yield* writeJson(answersFile, Object.fromEntries(kept));
    }
  }
  yield* writeJson(deckFile, deck);
  return aside === undefined ? undefined : data.fromData(aside);
});

export const decide = Effect.fn("decide")(function* (
  deckName: string,
  options: { readonly host: string; readonly port: number }
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const dir = path.join(data.root, "decisions");
  const deck = yield* readJson(Deck, path.join(dir, `${deckName}.json`));
  const answersFile = path.join(dir, `${deckName}.answers.json`);
  const page = yield* viewerPage("decide");
  const byId = new Map(deck.cards.map((c) => [c.id, c]));
  const lock = yield* Semaphore.make(1);
  const readAnswers = Effect.gen(function* () {
    return (yield* fs.exists(answersFile))
      ? yield* readJson(Answers, answersFile)
      : {};
  });

  const session = Effect.map(readAnswers, (answers) =>
    HttpServerResponse.jsonUnsafe({ answers, deck })
  );

  const save = Effect.gen(function* () {
    const input = yield* HttpServerRequest.schemaBodyJson(AnswerInput);
    const card = byId.get(input.id);
    const answer =
      card === undefined
        ? `no card ${input.id}`
        : answerTo(card, input, new Date().toISOString());
    if (typeof answer === "string") {
      return HttpServerResponse.jsonUnsafe(
        { message: answer },
        { status: 400 }
      );
    }
    // One write at a time: two quick answers would otherwise each read the file before the other
    // wrote it, and one would be lost.
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        yield* writeJson(answersFile, {
          ...(yield* readAnswers),
          [input.id]: answer,
        });
      })
    );
    return HttpServerResponse.jsonUnsafe({ ok: true });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          { message: String(error) },
          { status: 400 }
        )
      )
    )
  );

  const routes = Layer.mergeAll(
    HttpRouter.add("GET", "/api/session", session),
    HttpRouter.add("POST", "/api/answer", save),
    HttpRouter.add("GET", "/", Effect.succeed(HttpServerResponse.html(page))),
    HttpStaticServer.layer({ prefix: "/data", root: data.root })
  );
  yield* Effect.log(
    `${deck.cards.length} decisions: open http://${options.host}:${options.port}/ (Ctrl-C to stop; answers go in ${data.fromData(answersFile)} as you give them)`
  );
  return yield* Layer.launch(
    HttpRouter.serve(routes, { disableLogger: true }).pipe(
      Layer.provide(
        NodeHttpServer.layer(createServer, {
          host: options.host,
          port: options.port,
        })
      )
    )
  );
});
