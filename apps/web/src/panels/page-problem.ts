/**
 * What is wrong with an invalid page's file, in plain words: the schema's message (`Expected
 * "row" | "column", got "colum"` at `["root"]["children"][0]["type"]`) read as what each place in
 * the file holds and what to make it. A message it does not know is kept as it is.
 */

/** One thing wrong with the file: where it is, if the message says, and what to do about it. */
export interface ProblemPart {
  /** The place in the file, as a path into its JSON (`root.children[0].type`). */
  readonly at: string | null;
  /** What is there and what to make it, as a sentence that follows the place. */
  readonly says: string;
}

const KEY = /\["([^"\]]*)"\]/g;
const LEADING_DOT = /^\./;
const QUOTED = /"([^"]*)"/g;
const EXPECTED = /^Expected (.+?)(?:, got (.+))?$/;
const AT = /^\s*at (.+)$/;

/** A JSON path as the schema writes it (`["root"]["children"][0]`), as one reads it. */
const pathOf = (written: string) =>
  written.replace(KEY, ".$1").replace(LEADING_DOT, "").trim();

/** A value as the schema quotes it, in typographic quotes. */
const quoted = (value: string) => value.trim().replace(QUOTED, "“$1”");

/** The values a place may hold: "a", "a or b", "one of a, b or c". */
const choices = (expected: string) => {
  const all = expected.split(" | ").map(quoted);
  if (all.length === 1) {
    return all[0] as string;
  }
  const list = `${all.slice(0, -1).join(", ")} or ${all.at(-1)}`;
  return all.length === 2 ? list : `one of ${list}`;
};

/** What a message of the schema says, as the sentence that follows its place. */
const sentenceOf = (message: string) => {
  const expected: RegExpExecArray | null = EXPECTED.exec(message);
  if (expected !== null) {
    const [, wanted = "", got] = expected;
    return got === undefined
      ? `should be ${choices(wanted)}.`
      : `is ${quoted(got)}: make it ${choices(wanted)}.`;
  }
  if (message === "Missing key") {
    return "is missing: add it.";
  }
  if (message === "Unexpected key") {
    return "is not a field a page has: remove it.";
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
      : { at: null, says: at ? `${message} at ${at}` : message };
  });
};
