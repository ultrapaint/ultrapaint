const WORDS_RE = /\s+/;

/**
 * "AN" for Alessandro Narciso, "C" for Claude: the first letters of a name's first two words.
 * One person has the same initials wherever they are shown: on their comments, and on the rail.
 */
export const initialsOf = (name: string | null) => {
  const words = (name ?? "").trim().split(WORDS_RE).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
};
