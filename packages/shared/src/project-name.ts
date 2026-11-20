/**
 * What a project is called and drawn by when it was given nothing else (ADR 0107): its folder's
 * name, and that name's initials, the same in the server and the editor.
 */

const SEPARATOR_RE = /[\\/]+/;
/** A word of a name: letters and digits, whatever separates them (a space, `-`, `_`, `.`). */
const WORD_RE = /[\p{L}\p{N}]+/gu;

/** The folder's own name, the last part of its path; a trailing separator is not a part. */
export const folderName = (path: string): string =>
  path.split(SEPARATOR_RE).filter(Boolean).at(-1) ?? path;

/**
 * The initials a name is drawn by: its first letter, or the first letters of its first two words
 * when it has two or more (`shop` is S, `Pixel Forge` and `pixel-forge` are PF), upper case. A name
 * with no letter or digit is its first character, `?` when it is empty.
 */
export const initialsOf = (name: string): string => {
  const words = name.match(WORD_RE) ?? [];
  const letters =
    words.length === 0
      ? [...name.trim()].slice(0, 1)
      : words.slice(0, 2).map((word) => [...word][0] ?? "");
  return letters.join("").toLocaleUpperCase() || "?";
};
