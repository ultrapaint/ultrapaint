/**
 * The line a dotted path of keys is written on (`colors.primary`, `shadow.card`), in a file of
 * YAML front matter or of indented JSON: each key looked for among the lines of the one before it,
 * those after it and indented deeper than it, as `key:`, `"key":` or `'key':`. Where a key is not
 * found, the line of the last one that was; with none found, none. One-based, as an editor counts.
 */
export const lineOfKey = (text: string, at: string): number | undefined => {
  const lines = text.split("\n");
  /** The lines searched: the whole file, then the block of the key found last. */
  let from = 0;
  let to = lines.length;
  /** The indent the next key must be deeper than: none for the first. */
  let deeper = -1;
  let found: number | undefined;
  for (const key of at.split(".").filter((k) => k !== "")) {
    const written = new RegExp(
      `^(\\s*)(?:-\\s+)?(?:${escaped(key)}|"${escaped(key)}"|'${escaped(key)}')\\s*:`
    );
    const index = lines.findIndex((line, i) => {
      const match: RegExpExecArray | null =
        i >= from && i < to ? written.exec(line) : null;
      return match !== null && (match[1] ?? "").length > deeper;
    });
    if (index === -1) {
      break;
    }
    found = index + 1;
    deeper = indentOf(lines[index] ?? "");
    from = index + 1;
    to = blockEnd(lines, from, deeper);
  }
  return found;
};

const INDENT = /^\s*/;
const indentOf = (line: string) => {
  const match: RegExpExecArray | null = INDENT.exec(line);
  return match === null ? 0 : match[0].length;
};

/** A line that is only a comment, which YAML lets sit at any indent. */
const COMMENT = /^\s*(?:#|\/\/)/;

/**
 * Where a block that starts at `from` ends: the first line no deeper than `indent` that writes
 * something, a comment never ending it.
 */
const blockEnd = (lines: readonly string[], from: number, indent: number) => {
  const end = lines.findIndex(
    (line, i) =>
      i >= from &&
      line.trim() !== "" &&
      !COMMENT.test(line) &&
      indentOf(line) <= indent
  );
  return end === -1 ? lines.length : end;
};

const SPECIAL = /[.*+?^${}()|[\]\\]/g;
const escaped = (key: string) => key.replace(SPECIAL, "\\$&");
