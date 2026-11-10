/**
 * The design system's two files, read and written (ADR 0035): `design-system.json` holds the
 * tokens' names, groups and descriptions, text styles and baselines, and
 * `design.tokens.json` beside it every token's value, in the Design Tokens format (`dtcg.ts`).
 * Pure: `DesignSystemService` reads and writes the files, keeps what they read and says who
 * changed them.
 *
 * Reading, the design system is `design-system.json` with the tokens file's values laid over it:
 * the tokens file's value wins where both have one, and a token only it has is listed where its
 * kind goes. A `design-system.json` written before ADR 0035 still holds values of its own, which
 * stand where the tokens file has none, and a value neither file has is the code's. While the
 * tokens file does not read, the values are `design-system.json`'s and the code's, and the read
 * says why. A design system a writer gives (an agent's `write_design_system`) is read the same
 * way, with no tokens file and the current design system's value before the code's: a writer
 * that read `design-system.json`, which keeps no values, leaves them as they are.
 *
 * Writing, `design-system.json` is the design system without its values and `design.tokens.json`
 * the values in the format.
 *
 * The baselines a side keeps in `design-system.json` (`codeSync`, `designMd`, `sync`) move one
 * way, outside the undo history (ADR 0025, 0027, 0028): a step that writes the design system
 * keeps them as the file has them, and `baselineMover` moves one through the journal's `amend`,
 * whoever moves it: the code's side, DESIGN.md's, Sync's adapters.
 */
import {
  DESIGN_SYSTEM_FILE,
  DesignSystem,
  DocumentBaseline,
} from "@ultrapaint/contracts/design-system";
import { BadRequest } from "@ultrapaint/contracts/errors";
import { SyncBaseline } from "@ultrapaint/contracts/sync";
import {
  allTokens,
  fillValues,
  layValues,
  stripValues,
  type TokenValues,
  withEmptyValues,
} from "@ultrapaint/contracts/token-table";
import { serialise } from "@ultrapaint/design-document/factories";
import { Effect, Predicate, Schema } from "effect";
import { readDesignTokens, serialiseDesignTokens } from "./dtcg.ts";
import type { EditService } from "./edit.ts";

const decodeDesignSystem = Schema.decodeUnknownResult(DesignSystem);

/** The two files' texts, null for a file that is not there. */
export interface DesignSystemTexts {
  readonly system: string | null;
  readonly tokens: string | null;
}

/** The tokens the code declares, by name: where a value neither file has comes from. */
type CodeValues = ReadonlyMap<string, TokenValues>;

/** What the two files come to. */
export interface DesignSystemRead {
  /** Null without a `design-system.json`, or when it does not read. */
  readonly designSystem: DesignSystem | null;
  /** Why `design-system.json` does not read. */
  readonly problem: string | null;
  /** What `design.tokens.json` holds that could not be read or was left out (`dtcg.ts`). */
  readonly tokensNotes: readonly string[];
  /**
   * Why `design.tokens.json` does not read: until it does, the values are `design-system.json`'s
   * and the code's, and writing the files would lose the ones it holds.
   */
  readonly tokensProblem: string | null;
}

/** A design system's JSON decoded, every value it leaves out empty, or why it does not decode. */
const decoded = (
  json: unknown
): { readonly designSystem: DesignSystem } | { readonly problem: string } => {
  const result = decodeDesignSystem(withEmptyValues(json));
  return result._tag === "Success"
    ? { designSystem: result.success }
    : { problem: result.failure.message };
};

/** The code's value for every token the design system has none for. */
const fillFromCode = (ds: DesignSystem, code: CodeValues): DesignSystem =>
  fillValues(ds, (name) => code.get(name));

/**
 * The files as the design system they come to: `design-system.json`'s, the tokens file's values
 * laid over it, the code's where neither has one.
 */
export const readDesignSystem = (
  texts: DesignSystemTexts,
  code: CodeValues
): DesignSystemRead => {
  if (texts.system === null) {
    return {
      designSystem: null,
      problem: null,
      tokensNotes: [],
      tokensProblem: null,
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(texts.system);
  } catch (error) {
    return {
      designSystem: null,
      problem: `${DESIGN_SYSTEM_FILE} is not valid: not JSON: ${String(error)}`,
      tokensNotes: [],
      tokensProblem: null,
    };
  }
  const system = decoded(json);
  if ("problem" in system) {
    return {
      designSystem: null,
      problem: `${DESIGN_SYSTEM_FILE} is not valid: ${system.problem}`,
      tokensNotes: [],
      tokensProblem: null,
    };
  }
  const tokens = texts.tokens === null ? null : readDesignTokens(texts.tokens);
  if (tokens !== null && "problem" in tokens) {
    return {
      designSystem: fillFromCode(system.designSystem, code),
      problem: null,
      tokensNotes: [],
      tokensProblem: tokens.problem,
    };
  }
  const laid = tokens
    ? layValues(system.designSystem, tokens.tokens)
    : system.designSystem;
  return {
    designSystem: fillFromCode(laid, code),
    problem: null,
    tokensNotes: tokens?.notes ?? [],
    tokensProblem: null,
  };
};

/**
 * A design system a writer gives, as its JSON, read as `design-system.json` is: a value it leaves
 * out is the current design system's, else the code's.
 */
export const readGivenDesignSystem = (
  given: unknown,
  from: { readonly code: CodeValues; readonly current: DesignSystem | null }
): { readonly designSystem: DesignSystem } | { readonly problem: string } => {
  const read = decoded(given);
  if ("problem" in read) {
    return { problem: `the design system is not valid: ${read.problem}` };
  }
  const { current } = from;
  const known = new Map(
    current ? allTokens(current).map((t) => [t.name, t]) : []
  );
  return {
    designSystem: fillFromCode(
      fillValues(read.designSystem, (name) => known.get(name)),
      from.code
    ),
  };
};

/** The two files' texts for a design system: `design-system.json` without its values. */
export const writeDesignSystem = (
  ds: DesignSystem
): { readonly system: string; readonly tokens: string } => ({
  system: serialise(stripValues(ds)),
  tokens: serialiseDesignTokens(ds),
});

/** What each side keeps in `design-system.json`: what it and the design system last agreed on. */
export interface Baselines {
  readonly codeSync: DocumentBaseline;
  readonly designMd: DocumentBaseline;
  readonly sync: SyncBaseline;
}
export type BaselineSide = keyof Baselines;

/** A side's baseline as it moves: the next from the one the file has; undefined leaves it. */
export type BaselineMove<S extends BaselineSide> = (
  previous: Baselines[S] | undefined
) => Baselines[S] | undefined;

const BASELINES: { readonly [S in BaselineSide]: Schema.Codec<Baselines[S]> } =
  {
    codeSync: DocumentBaseline,
    designMd: DocumentBaseline,
    sync: SyncBaseline,
  };

/** A design system with the baselines `kept` has, whatever it said itself. */
export const keepBaselines = (
  ds: DesignSystem,
  kept: DesignSystem | null
): DesignSystem => {
  const { codeSync: _c, designMd: _d, sync: _s, ...rest } = ds;
  return {
    ...rest,
    ...(kept?.codeSync && { codeSync: kept.codeSync }),
    ...(kept?.designMd && { designMd: kept.designMd }),
    ...(kept?.sync && { sync: kept.sync }),
  };
};

/** Whether a baseline agrees on the same values: nothing agreed is `{}`. */
const sameAgreement = (
  previous: DocumentBaseline | undefined,
  agreed: Readonly<Record<string, string>>
): boolean => {
  const before = Object.entries(previous?.agreed ?? {});
  return (
    before.length === Object.keys(agreed).length &&
    before.every(([key, value]) => agreed[key] === value)
  );
};

/**
 * A side agreeing with the design system on these values from `at`, the matches it keeps kept;
 * the baseline as it is when it agrees on the same values already.
 */
export const agreeOn =
  (
    agreed: Readonly<Record<string, string>>,
    at: number
  ): BaselineMove<"codeSync" | "designMd"> =>
  (previous) =>
    sameAgreement(previous, agreed)
      ? previous
      : {
          agreed,
          at,
          ...(previous?.matches !== undefined && {
            matches: previous.matches,
          }),
        };

/**
 * `design-system.json`'s text with one side's baseline moved, everything else as the file has
 * it. The text as it is when the baseline does not change; null for a file that is not there or
 * does not read.
 */
export const withBaseline = <S extends BaselineSide>(
  text: string | null,
  side: S,
  move: BaselineMove<S>
): string | null => {
  if (text === null) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // A file that does not read is left alone: reading it says why.
    return null;
  }
  if (!Predicate.isObject(json)) {
    return null;
  }
  const record = json as Record<string, unknown>;
  const previous = Schema.decodeUnknownOption(BASELINES[side])(record[side]);
  const next = move(previous._tag === "Some" ? previous.value : undefined);
  if (
    next === undefined ||
    JSON.stringify(next) === JSON.stringify(record[side])
  ) {
    return text;
  }
  return serialise({ ...record, [side]: next });
};

/**
 * Moves one side's baseline in `design-system.json` (`rel`), outside the undo history: under the
 * journal's lock, and carried into every step that touched the file, so undoing a token edit
 * never takes back what a side agreed meanwhile. A file that is not there or does not read is
 * left alone, and says so.
 */
export const baselineMover =
  (edit: EditService["Service"], rel: string) =>
  <S extends BaselineSide>(
    side: S,
    move: BaselineMove<S>
  ): Effect.Effect<void, BadRequest> =>
    edit
      .amend(rel, (content) => {
        const next = withBaseline(content, side, move);
        return next === null
          ? Effect.fail(
              new BadRequest({
                message: `${DESIGN_SYSTEM_FILE} is not there or does not read`,
              })
            )
          : Effect.succeed([next, undefined] as const);
      })
      .pipe(
        Effect.mapError((error) =>
          error._tag === "BadRequest"
            ? error
            : new BadRequest({
                message: `${DESIGN_SYSTEM_FILE}'s baseline could not be moved: ${error.message}`,
              })
        )
      );
