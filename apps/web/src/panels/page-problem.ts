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

/** A file `JSON.parse` refused, and what it said (`not JSON: Unexpected token …`). */
const NOT_JSON = /^not JSON: ([\s\S]*)$/;
/**
 * A parser's message with the text around the error, quoted and cut at either end:
 * `Unexpected token '<', ..."ldren": [<<<<<<< HE"... is not valid JSON`.
 */
const EXCERPT =
  /^([\s\S]*?), (?:\.\.\.)?"([\s\S]*)"(?:\.\.\.)? is not valid JSON$/;
/** What a parser quotes of the file: a character or a token (`'<'`, `','`). */
const QUOTED = /'([^'\s]+)'/g;

/** A parser's own words, what it quotes of the file set in code. */
const quoted = (text: string): Said[] => {
  const said: Said[] = [];
  let from = 0;
  for (const match of text.matchAll(QUOTED)) {
    if (match.index > from) {
      said.push(words(text.slice(from, match.index)));
    }
    said.push(value(match[1] ?? ""));
    from = match.index + match[0].length;
  }
  if (from < text.length) {
    said.push(words(text.slice(from)));
  }
  return said;
};

/**
 * What a file the parser refused says: its message as a sentence after "The file isn’t JSON", what
 * it quotes of the file in code, and the text around the error in code as one line, without the
 * parser's quotes and dots around it.
 */
const notJsonOf = (message: string): Said[] => {
  const lead = words("The file isn’t JSON: ");
  const excerpt: RegExpExecArray | null = EXCERPT.exec(message);
  if (excerpt === null) {
    const said = message.charAt(0).toLowerCase() + message.slice(1);
    return [lead, ...quoted(said), ...(said.endsWith(".") ? [] : [words(".")])];
  }
  const [, what = "", around = ""] = excerpt;
  return [
    lead,
    ...quoted(what.charAt(0).toLowerCase() + what.slice(1)),
    words(" in "),
    value(around.replaceAll("\n", " ")),
    words("."),
  ];
};

/** The parts of a page's problem, each with its place in the file when the message gives one. */
export const problemParts = (problem: string): readonly ProblemPart[] => {
  // The parser's message is one, whatever lines the text it quotes runs over.
  const notJson: RegExpExecArray | null = NOT_JSON.exec(problem);
  if (notJson !== null) {
    return [{ at: null, says: notJsonOf(notJson[1] ?? "") }];
  }
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
