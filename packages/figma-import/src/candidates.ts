/**
 * Which components of the repository a Figma component might be, by name. A guess for the
 * agent to confirm, or to put to the user: `Button/Primary` is most likely `Button`.
 */
import type { ComponentCandidate } from "@ultrapaint/contracts/figma";

const SEPARATOR_RE = /[\s/_\-.]+/;
const CAMEL_RE = /([a-z0-9])([A-Z])/g;
const NON_WORD_RE = /[^a-z0-9 ]/g;

/** Words of a name, lower case: `icon/ArrowLeft` → `["icon", "arrow", "left"]`. */
const wordsOf = (name: string): string[] =>
  name
    .replace(CAMEL_RE, "$1 $2")
    .toLowerCase()
    .replace(NON_WORD_RE, " ")
    .split(SEPARATOR_RE)
    .filter((word) => word.length > 0);

const bigrams = (word: string) => {
  const set = new Set<string>();
  for (let i = 0; i < word.length - 1; i += 1) {
    set.add(word.slice(i, i + 2));
  }
  return set;
};

/** Sørensen–Dice on the letters, for names that are close but not the same. */
const similarity = (a: string, b: string) => {
  if (a === b) {
    return 1;
  }
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (ba.size === 0 || bb.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const gram of ba) {
    if (bb.has(gram)) {
      shared += 1;
    }
  }
  return (2 * shared) / (ba.size + bb.size);
};

const MIN_SCORE = 0.45;
const LIMIT = 3;

/** The likeliest matches for a Figma component name, best first, none below a fair score. */
export const candidatesFor = (
  figmaName: string,
  components: readonly { readonly importFrom: string; readonly name: string }[]
): ComponentCandidate[] => {
  const words = wordsOf(figmaName);
  // `Button/Primary` and `Buttons / Large` both mean the first part; a bare name is itself.
  const joined = words.join("");
  const last = words.at(-1) ?? "";
  const first = words[0] ?? "";
  const scored = components.map((component) => {
    const target = wordsOf(component.name).join("");
    const score = Math.max(
      similarity(joined, target),
      similarity(first, target) * 0.95,
      similarity(last, target) * 0.9,
      target.length > 2 && joined.includes(target) ? 0.75 : 0
    );
    return { importFrom: component.importFrom, name: component.name, score };
  });
  return scored
    .filter((candidate) => candidate.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, LIMIT)
    .map((candidate) => ({
      ...candidate,
      score: Math.round(candidate.score * 100) / 100,
    }));
};
