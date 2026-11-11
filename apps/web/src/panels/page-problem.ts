/**
 * What is wrong with an invalid page's file, in plain words: the schema's message (`Expected
 * "row" | "column", got "colum"` at `["root"]["children"][0]["type"]`) read as what each place in
 * the file holds and what to make it. A message it does not know is kept as it is.
 */

/** A piece of a sentence: words, or a value as the file writes it, which is set in code. */
export interface Said {
  readonly code: boolean;
  readonly text: string;
}

/** One thing wrong with the file: where it is, if the message says, and what to do about it. */
export interface ProblemPart {
  /** The place in the file, as a path into its JSON (`root.children[0].type`). */
  readonly at: string | null;
  /** What is there and what to make it, as a sentence that follows the place. */
  readonly says: readonly Said[];
}

const KEY = /\["([^"\]]*)"\]/g;
const LEADING_DOT = /^\./;
const EXPECTED = /^Expected (.+?)(?:, got (.+))?$/;
const AT = /^\s*at (.+)$/;

/** A JSON path as the schema writes it (`["root"]["children"][0]`), as one reads it. */
const pathOf = (written: string) =>
  written.replace(KEY, ".$1").replace(LEADING_DOT, "").trim();

const words = (text: string): Said => ({ code: false, text });
/** A value as the schema writes it (`"row"`), set in code as the file has it. */
const value = (text: string): Said => ({ code: true, text: text.trim() });

/** The values a place may hold: "a", "a or b", "one of a, b or c". */
const choices = (expected: string): Said[] => {
  const all = expected.split(" | ").map(value);
  if (all.length === 1) {
    return all;
  }
  const list = all.flatMap((choice, i) => {
    if (i === 0) {
      return [choice];
    }
    return [words(i === all.length - 1 ? " or " : ", "), choice];
  });
  return all.length === 2 ? list : [words("one of "), ...list];
};

/** What a message of the schema says, as the sentence that follows its place. */
const sentenceOf = (message: string): Said[] | null => {
  const expected: RegExpExecArray | null = EXPECTED.exec(message);
  if (expected !== null) {
    const [, wanted = "", got] = expected;
    return got === undefined
      ? [words("should be "), ...choices(wanted), words(".")]
      : [
          words("is "),
          value(got),
          words(": make it "),
          ...choices(wanted),
          words("."),
        ];
  }
  if (message === "Missing key") {
    return [words("is missing: add it.")];
  }
  if (message === "Unexpected key") {
    return [words("is not a field a page has: remove it.")];
  }
  return null;
};

/** The parts of a page's problem, each with its place in the file when the message gives one. */
export const problemParts = (problem: string): readonly ProblemPart[] => {
  const parts: { at: string | null; message: string }[] = [];
  for (const line of problem.split("\n")) {
    const at: RegExpExecArray | null = AT.exec(line);
    const last = parts.at(-1);
    if (at !== null && last !== undefined && last.at === null) {
      last.at = pathOf(at[1] ?? "");
    } else if (line.trim() !== "") {
      parts.push({ at: null, message: line.trim() });
    }
  }
  return parts.map(({ at, message }) => {
    const says = sentenceOf(message);
    return says !== null && at !== null && at !== ""
      ? { at, says }
      : { at: null, says: [words(at ? `${message} at ${at}` : message)] };
  });
};
