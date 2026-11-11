/**
 * `fixes`: what the rating decks of recall rounds found real in the editor's own screens, checked
 * against today's code, as a deck of fixes. The held-out sections are the editor's panels as they
 * were; the code has moved since. The real problems of each panel (from every round's deck, its
 * sections grouped by the code files they share) go to one model with the old pictures and code
 * and today's files, and it says which repeat one another, which still hold, where, and what the
 * fix takes now.
 *
 * Its answers are kept in `runs/<name>/<panel>@<model>.json`; the deck `<name>` has a card for each
 * problem that still holds (or only a new picture could tell), smallest fix first, with the fix
 * as the agent's call: Right to make it, Wrong to leave it.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { Answers, type Card, Deck, writeDeck } from "./decide.ts";
import { prompt, readJson, writeJson, writeText } from "./layout.ts";
import { Models } from "./models.ts";
import { rateDeckName, Section } from "./recall.ts";

const HOLDS = ["yes", "no", "unsure"] as const;
const SIZES = ["small", "medium", "large"] as const;

export const Checked = Schema.Struct({
  problems: Schema.Array(
    Schema.Struct({
      fix: Schema.String,
      holds: Schema.Literals(HOLDS),
      n: Schema.Number,
      same: Schema.Number,
      size: Schema.Literals(SIZES),
      where: Schema.String,
    })
  ),
});
export type Checked = typeof Checked.Type;

const checkedAnswer = {
  decode: Checked,
  schema: {
    additionalProperties: false,
    properties: {
      problems: {
        items: {
          additionalProperties: false,
          properties: {
            fix: { type: "string" },
            holds: { enum: [...HOLDS], type: "string" },
            n: { type: "integer" },
            same: { type: "integer" },
            size: { enum: [...SIZES], type: "string" },
            where: { type: "string" },
          },
          required: ["n", "same", "holds", "where", "size", "fix"],
          type: "object",
        },
        type: "array",
      },
    },
    required: ["problems"],
    type: "object",
  },
};

/** A problem rated real in a round's deck, with the card it was rated on. */
export interface RealProblem {
  readonly card: Card;
  /** The agent's fix when it was rated, from the card's call. */
  readonly fix: string;
  readonly problem: string;
  readonly section: string;
}

const QUESTION_RE = /\n\nWould a careful designer fix this here\?[\s\S]*$/;
/** A section's code is `code/<path in the repository>`. */
const CODE_DIR_RE = /^code\//;
/** How a card's call starts when it is a fix. */
const FIX_CALL = "**I'd fix it.** ";

/** The fix a card's call names, from its first line; none when the call was to leave it. */
const fixOfCall = (proposal: string | undefined) => {
  const first = (proposal ?? "").split("\n")[0] ?? "";
  return first.startsWith(FIX_CALL) ? first.slice(FIX_CALL.length) : "";
};

/** The problems a deck's answers call real, as the cards said them. */
export const realProblems = (
  deck: Deck,
  answers: typeof Answers.Type
): RealProblem[] =>
  deck.cards.flatMap((card) =>
    answers[card.id]?.choice === "real"
      ? [
          {
            card,
            fix: fixOfCall(card.proposal),
            problem: (card.body ?? "").replace(QUESTION_RE, "").trim(),
            section: card.id.slice(0, card.id.lastIndexOf("-")),
          },
        ]
      : []
  );

/**
 * Sections grouped into panels: two sections whose code shares a file other than `DESIGN.md` are
 * one panel, its code their files together.
 */
export const panelsOf = (
  sections: ReadonlyMap<string, readonly string[]>
): string[][] => {
  const groups: { files: Set<string>; ids: string[] }[] = [];
  for (const [id, files] of [...sections].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const own = files.filter((f) => path.basename(f) !== "DESIGN.md");
    const joined = groups.filter((g) => own.some((f) => g.files.has(f)));
    const into = { files: new Set(own), ids: [id] };
    for (const g of joined) {
      into.ids.push(...g.ids);
      for (const f of g.files) {
        into.files.add(f);
      }
      groups.splice(groups.indexOf(g), 1);
    }
    groups.push(into);
  }
  return groups.map((g) => g.ids.sort());
};

const SIZE_ORDER: Readonly<Record<string, number>> = {
  large: 2,
  medium: 1,
  small: 0,
};

/** The deck: a card for each problem that still holds, or may, the smallest fix first. */
export const fixesDeck = (
  name: string,
  checked: readonly {
    readonly answer: Checked["problems"][number];
    readonly problem: RealProblem;
    readonly sectionName: string;
  }[]
): Deck => ({
  cards: checked
    .filter(({ answer }) => answer.same === 0 && answer.holds !== "no")
    // Two rounds' decks can hold the same card: the first is kept.
    .filter(
      ({ problem }, i, all) =>
        all.findIndex((c) => c.problem.card.id === problem.card.id) === i
    )
    .sort(
      (a, b) =>
        (SIZE_ORDER[a.answer.size] ?? 0) - (SIZE_ORDER[b.answer.size] ?? 0) ||
        Number(a.answer.holds === "unsure") -
          Number(b.answer.holds === "unsure")
    )
    .map(({ answer, problem, sectionName }) => ({
      body: [
        problem.problem,
        `${sectionName}, today at \`${answer.where || "?"}\`; a ${answer.size} fix.${
          answer.holds === "unsure"
            ? " Only a new picture can tell whether it still shows."
            : ""
        }`,
      ].join("\n\n"),
      id: problem.card.id,
      options: [
        { key: "fix", label: "Fix it", leads: "I make the fix" },
        { key: "leave", label: "Leave it", leads: "Nothing changes" },
      ],
      pictures: (problem.card.pictures ?? []).slice(0, 2),
      proposal: `**I'd fix it.** ${answer.fix}`,
      recommend: "fix",
      title: problem.card.title,
    })),
  intro:
    "The problems rated real in the editor's own panels that still hold in today's code, the smallest fix first, with the fix I would make. Right and I make it; Wrong and I leave it. The pictures are the panels as they were reviewed, not as they are today.",
  title: `${name}: fixes to the editor`,
});

export const fixes = Effect.fn("fixes")(function* (options: {
  readonly concurrency: number;
  readonly effort: string;
  readonly model: string;
  readonly name: string;
  readonly rounds: readonly string[];
}) {
  const { checkout, data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  const out = path.join(data.runs, options.name);

  const problems: RealProblem[] = [];
  for (const round of options.rounds) {
    const dir = path.join(data.root, "decisions");
    const deck = yield* readJson(
      Deck,
      path.join(dir, `${rateDeckName(round)}.json`)
    );
    const answersFile = path.join(dir, `${rateDeckName(round)}.answers.json`);
    const answers = (yield* fs.exists(answersFile))
      ? yield* readJson(Answers, answersFile)
      : {};
    problems.push(...realProblems(deck, answers));
  }
  const sections = new Map<string, typeof Section.Type>();
  for (const id of new Set(problems.map((p) => p.section))) {
    sections.set(
      id,
      yield* readJson(Section, path.join(data.sections, id, "section.json"))
    );
  }
  const today = (file: string) => file.replace(CODE_DIR_RE, "");
  const panels = panelsOf(
    new Map([...sections].map(([id, s]) => [id, s.code.map(today)]))
  );

  const checked = yield* Effect.forEach(
    panels,
    (ids) =>
      Effect.gen(function* () {
        const ofPanel = problems.filter((p) => ids.includes(p.section));
        const panel = ids[0] ?? "panel";
        const file = path.join(
          out,
          `${panel}@${options.model.replaceAll(/[^\w.-]/g, "-")}.json`
        );
        const of = ids.flatMap((id) => {
          const s = sections.get(id);
          return s === undefined ? [] : [{ id, s }];
        });
        const answer = (yield* fs.exists(file))
          ? yield* readJson(Checked, file)
          : yield* Effect.gen(function* () {
              const asked = yield* models.ask({
                cwd: data.sections,
                dirs: [checkout],
                effort: options.effort,
                images: of.flatMap(({ id, s }) =>
                  s.pictures.map((p) => path.join(id, p.file))
                ),
                model: options.model,
                prompt: yield* prompt("fixes-check", {
                  checkout,
                  name: of[0]?.s.name ?? panel,
                  newCode: [
                    ...new Set(of.flatMap(({ s }) => s.code.map(today))),
                  ]
                    .map((f) => `- \`${f}\``)
                    .join("\n"),
                  oldCode: of
                    .map(
                      ({ id, s }) =>
                        `${id} (${s.commit}):\n${[...s.pictures.map((p) => p.file), ...s.code].map((f) => `- \`${id}/${f}\``).join("\n")}`
                    )
                    .join("\n\n"),
                  pictures: ids.map((id) => `\`${id}/pictures/\``).join(", "),
                  problems: ofPanel
                    .map(
                      (p, i) =>
                        `${i + 1}. **${p.card.title}** (${p.section}): ${p.problem}${p.fix ? ` The fix then: ${p.fix}` : ""}`
                    )
                    .join("\n"),
                }),
                ...checkedAnswer,
              });
              yield* writeJson(file, asked.value);
              return asked.value;
            });
        const kept = answer.problems.filter(
          (a) => a.same === 0 && a.holds !== "no"
        );
        yield* Effect.log(
          `${panel}: ${ofPanel.length} problems, ${answer.problems.filter((a) => a.same === 0).length} distinct, ${kept.length} still hold or may`
        );
        return ofPanel.flatMap((problem, i) => {
          const found = answer.problems.find((a) => a.n === i + 1);
          return found === undefined
            ? []
            : [
                {
                  answer: found,
                  problem,
                  sectionName: sections.get(problem.section)?.name ?? panel,
                },
              ];
        });
      }).pipe(
        Effect.catchTag("EvalsError", (error) =>
          Effect.as(
            Effect.logWarning(
              `${ids.join(", ")}: not checked: ${error.message}`
            ),
            []
          )
        )
      ),
    { concurrency: options.concurrency }
  );
  const deck = fixesDeck(options.name, checked.flat());
  yield* writeDeck(options.name, deck);
  const count = (size: string) =>
    deck.cards.filter((c) => c.body?.includes(`a ${size} fix`)).length;
  yield* writeText(
    path.join(out, "fixes.md"),
    `# Fixes: ${options.name}\n\nFrom ${options.rounds.join(", ")}: ${problems.length} problems rated real, ${deck.cards.length} that still hold or may (${count("small")} small, ${count("medium")} medium, ${count("large")} large).\n`
  );
  yield* Effect.log(
    `${deck.cards.length} fixes to decide: pnpm evals decide ${options.name}`
  );
});
