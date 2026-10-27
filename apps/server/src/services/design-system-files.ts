/**
 * The design system's two files, read and written (ADR 0035): `design-system.json` holds the
 * tokens' names, groups and descriptions, text styles, components and baselines, and
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
 */
import {
  DESIGN_SYSTEM_FILE,
  DesignSystem,
} from "@ultrapaint/contracts/design-system";
import {
  allTokens,
  fillValues,
  layValues,
  stripValues,
  type TokenValues,
  withEmptyValues,
} from "@ultrapaint/contracts/token-table";
import { serialise } from "@ultrapaint/design-document/factories";
import { Schema } from "effect";
import { readDesignTokens, serialiseDesignTokens } from "./dtcg.ts";

const decodeDesignSystem = Schema.decodeUnknownResult(DesignSystem);

/** The two files' texts, null for a file that is not there. */
export interface DesignSystemTexts {
  readonly system: string | null;
  readonly tokens: string | null;
}

/** The tokens the code declares, by name: where a value neither file has comes from. */
export type CodeValues = ReadonlyMap<string, TokenValues>;

/** What the two files come to. */
export interface DesignSystemRead {
  /** Null without a `design-system.json`, or when it does not read. */
  readonly designSystem: DesignSystem | null;
  /** Why `design-system.json` does not read. */
  readonly problem: string | null;
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
    return { designSystem: null, problem: null, tokensProblem: null };
  }
  let json: unknown;
  try {
    json = JSON.parse(texts.system);
  } catch (error) {
    return {
      designSystem: null,
      problem: `${DESIGN_SYSTEM_FILE} is not valid: not JSON: ${String(error)}`,
      tokensProblem: null,
    };
  }
  const system = decoded(json);
  if ("problem" in system) {
    return {
      designSystem: null,
      problem: `${DESIGN_SYSTEM_FILE} is not valid: ${system.problem}`,
      tokensProblem: null,
    };
  }
  const tokens = texts.tokens === null ? null : readDesignTokens(texts.tokens);
  if (tokens !== null && "problem" in tokens) {
    return {
      designSystem: fillFromCode(system.designSystem, code),
      problem: null,
      tokensProblem: tokens.problem,
    };
  }
  const laid = tokens
    ? layValues(system.designSystem, tokens.tokens)
    : system.designSystem;
  return {
    designSystem: fillFromCode(laid, code),
    problem: null,
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

/**
 * `design-system.json`'s text with what one side and the design system agree on set, the
 * matches the file keeps for it kept, everything else as the file has it: a baseline moved
 * outside the undo history (ADR 0027, 0028). Null for a file that is not there or does not read.
 */
export const withAgreement = (
  text: string | null,
  side: "codeSync" | "designMd",
  agreed: Readonly<Record<string, string>>,
  at: number
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
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return null;
  }
  const record = json as Record<string, unknown>;
  const previous = record[side] as { readonly matches?: unknown } | undefined;
  return serialise({
    ...record,
    [side]: {
      agreed,
      at,
      ...(previous?.matches !== undefined && { matches: previous.matches }),
    },
  });
};
