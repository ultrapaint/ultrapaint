/**
 * What a design says that its brief did not: every text on the page that is not the brief's
 * content. The brief carries all of the reference's text, so what is left is what the agent
 * wrote of its own: a label, a description, a caption, a heading over a group that was clear
 * without it. Most of it is noise ("less is more"); the judge says which, and so can a person.
 *
 * Counted in code, from the page file, so a round's number does not depend on a model's eye.
 */

import { Predicate, Schema } from "effect";

/** A text the page shows, and the node that holds it. */
export interface PageText {
  /** The node the text belongs to. */
  readonly node: string;
  /** The node around it, whose picture shows the text in its place. */
  readonly parent: string;
  readonly text: string;
}

/** The text an instance's props show, besides its `text`: a field's placeholder or value. */
const VISIBLE_PROPS = [
  "placeholder",
  "label",
  "title",
  "description",
  "value",
  "defaultValue",
] as const;

/**
 * Every text a page file shows, in document order. The page is JSON as read (`readPageFile`): only
 * the fields that hold text are looked at.
 */
export const pageTexts = (page: unknown): readonly PageText[] => {
  const found: PageText[] = [];
  const visit = (node: unknown, parent: string) => {
    if (!Predicate.isObject(node)) {
      return;
    }
    const id = Predicate.isString(node.id) ? node.id : parent;
    const push = (text: unknown) => {
      if (Predicate.isString(text) && text.trim() !== "") {
        found.push({ node: id, parent, text: text.trim() });
      }
    };
    push(node.text);
    if (Predicate.isObject(node.props)) {
      for (const key of VISIBLE_PROPS) {
        push(node.props[key]);
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        visit(child, id);
      }
    }
  };
  visit(Predicate.isObject(page) ? page.root : undefined, "root");
  return found;
};

/** Lower case, quotes and dashes made plain, everything but letters and digits a space. */
const normalise = (text: string) =>
  ` ${text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;

const DIGIT = /\d/;
const CONTENT_HEADING = /^## Content/m;
const NEXT_SECTION = /^## /m;

/** Words of a text that carry meaning: those of three letters and more, and every number. */
const wordsOf = (normalised: string) =>
  normalised
    .trim()
    .split(" ")
    .filter((w) => w.length >= 3 || DIGIT.test(w));

/**
 * Whether a text is the brief's: found in it whole, or, for a longer one, its words nearly all
 * there (an agent that shortens a sentence or swaps a word still wrote the brief's text).
 */
const inBrief = (text: string, brief: string, briefWords: Set<string>) => {
  const normal = normalise(text);
  if (normal.trim() === "" || brief.includes(normal)) {
    return true;
  }
  const words = wordsOf(normal);
  if (words.length < 4) {
    return false;
  }
  const known = words.filter((w) => briefWords.has(w)).length;
  return known / words.length >= 0.8;
};

const QUOTED = /["“]([^"”]+)["”]/g;
const ITEM = /^\s*([-*|>]|\d+\.)/;

/**
 * The part of a brief that is the screen's content: the list items, the table rows and the
 * quoted copy of its `## Content` section. A group's purpose sentence ("The customers behind the
 * revenue") and the headings are the brief writer's words: shown on the page as a description,
 * they are exactly the noise this counts, so they must not count as the brief's.
 */
export const briefContent = (brief: string) => {
  const start = brief.search(CONTENT_HEADING);
  const rest = start === -1 ? brief : brief.slice(start + "## Content".length);
  const end = rest.search(NEXT_SECTION);
  const section = end === -1 ? rest : rest.slice(0, end);
  return section
    .split("\n")
    .flatMap((line) => {
      if (line.startsWith("#")) {
        return [];
      }
      if (ITEM.test(line)) {
        return [line];
      }
      return [...line.matchAll(QUOTED)].map((m) => m[1] ?? "");
    })
    .join("\n");
};

export interface AddedText extends PageText {
  readonly words: number;
}

/** The texts of a page its brief's content does not hold, each once. */
export const addedTexts = (
  texts: readonly PageText[],
  brief: string
): readonly AddedText[] => {
  const normalBrief = normalise(briefContent(brief));
  const briefWords = new Set(wordsOf(normalBrief));
  const seen = new Set<string>();
  const added: AddedText[] = [];
  for (const text of texts) {
    const key = normalise(text.text);
    // A lone symbol or digit ("•", "/", "3") is decoration or data, not words.
    if (key.trim().length < 2 || seen.has(key)) {
      continue;
    }
    if (!inBrief(text.text, normalBrief, briefWords)) {
      seen.add(key);
      added.push({ ...text, words: key.trim().split(" ").length });
    }
  }
  return added;
};

export const AddedTextEntry = Schema.Struct({
  index: Schema.Number,
  /**
   * Where it is on the whole page: the page's picture (`shots/desktop-01.jpg`) and the box of the
   * node around it there, found by matching its own picture against the page's.
   */
  mark: Schema.optional(
    Schema.Struct({
      box: Schema.Struct({
        height: Schema.Number,
        width: Schema.Number,
        x: Schema.Number,
        y: Schema.Number,
      }),
      picture: Schema.String,
    })
  ),
  node: Schema.String,
  parent: Schema.String,
  /** The picture of the node around it, from the run's directory. */
  picture: Schema.optional(Schema.String),
  text: Schema.String,
  words: Schema.Number,
});
export type AddedTextEntry = typeof AddedTextEntry.Type;
export const ADDED_TEXT_FILE = "added-text.json";
