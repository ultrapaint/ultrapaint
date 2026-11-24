/**
 * CSS split where a separator stands at its top level, outside brackets and quotes: a fill's
 * layers and a gradient's arguments, a shadow list's shadows, the words of each. Pure.
 */

const SPACES = new Set([" ", "\n", "\t"]);

/** How deep in brackets a character leaves the text, or which quote it is in. */
interface Scan {
  depth: number;
  quote: string | null;
}

/** Steps `scan` over one character; true where it stands outside brackets and quotes. */
const outside = (scan: Scan, c: string): boolean => {
  if (scan.quote !== null) {
    scan.quote = c === scan.quote ? null : scan.quote;
    return false;
  }
  if (c === '"' || c === "'") {
    scan.quote = c;
  } else if (c === "(") {
    scan.depth += 1;
  } else if (c === ")") {
    scan.depth -= 1;
  }
  return scan.depth === 0;
};

/** `text` split where `separator` stands outside brackets and quotes, each part trimmed. */
export const splitTop = (text: string, separator: "," | " "): string[] => {
  const parts: string[] = [];
  const scan: Scan = { depth: 0, quote: null };
  const splits = (c: string) => (separator === "," ? c === "," : SPACES.has(c));
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] ?? "";
    if (outside(scan, c) && splits(c)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  const trimmed = parts.map((p) => p.trim());
  // An empty argument is kept, so that the parser refuses it: `red,,blue` is no gradient.
  return separator === "," ? trimmed : trimmed.filter((p) => p !== "");
};
