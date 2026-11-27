/**
 * A text's runs (ADR 0163): its words as stretches, each with a link or an underline of its own,
 * `text` kept as their words joined. Pure: the operations settle a text's runs with them, the
 * frame and the inspector map an edit of the words onto them from the offsets of what it changed,
 * and the renderer and the code writer read a text by them.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type {
  DesignNode,
  TextNode,
  TextRun,
} from "@ultrapaint/contracts/document";
import type { Found } from "./ops.ts";
import { findNode, isRecord } from "./tree.ts";

/** What a run sets besides its words: a link, an underline. */
export interface RunFields {
  readonly link?: string | undefined;
  readonly underline?: boolean | undefined;
}

/** A stretch of a text's words, by the offsets of its first character and of the one after it. */
export interface WordsRange {
  readonly end: number;
  readonly start: number;
}

/** A text's words and its runs, as an update sets them: null runs take them off. */
export interface TextWords {
  readonly runs?: readonly TextRun[] | null;
  readonly text: string;
}

/** A text's words and runs as the JSON an update's `set` holds. */
export const asSet = (words: TextWords): Record<string, JsonValue> =>
  words as unknown as Record<string, JsonValue>;

/** Where a run leads; none for a link of no words. */
const linkOf = (run: RunFields): string | undefined =>
  run.link === undefined || run.link === "" ? undefined : run.link;

const fieldsOf = (run: TextRun): RunFields => {
  const link = linkOf(run);
  return {
    ...(link !== undefined && { link }),
    ...(run.underline === true && { underline: true }),
  };
};

const sameFields = (a: RunFields, b: RunFields) =>
  a.link === b.link && a.underline === b.underline;

const isPlain = (run: TextRun) =>
  linkOf(run) === undefined && run.underline !== true;

/** The runs' words, joined: what `text` holds beside them. */
export const wordsOfRuns = (runs: readonly TextRun[]): string =>
  runs.map((run) => run.text).join("");

/**
 * The runs as they are kept: a run of no words gone, a link of no words and `underline: false`
 * left out, neighbours that set the same joined; null when no run is left that sets anything, as
 * a text whose runs are plain words is a plain text.
 */
export const settleRuns = (
  runs: readonly TextRun[] | undefined
): TextRun[] | null => {
  const kept: TextRun[] = [];
  for (const run of runs ?? []) {
    if (run.text === "") {
      continue;
    }
    const fields = fieldsOf(run);
    const last = kept.at(-1);
    if (last && sameFields(fieldsOf(last), fields)) {
      kept[kept.length - 1] = { ...last, text: last.text + run.text };
    } else {
      kept.push({ text: run.text, ...fields });
    }
  }
  return kept.some((run) => !isPlain(run)) ? kept : null;
};

/** A text's runs, its words as one plain run when it has none. Its runs win over its `text`. */
export const runsOf = (node: TextNode): readonly TextRun[] =>
  node.runs !== undefined && node.runs.length > 0
    ? node.runs
    : [{ text: node.text }];

/** Whether a text holds runs: some of its words link or are underlined. */
export const hasRuns = (
  node: DesignNode
): node is TextNode & {
  readonly runs: readonly TextRun[];
} => node.type === "text" && node.runs !== undefined && node.runs.length > 0;

/** The links a text's runs lead to, in order. */
export const runLinks = (node: DesignNode): string[] =>
  hasRuns(node)
    ? node.runs.flatMap((run) => {
        const link = linkOf(run);
        return link === undefined ? [] : [link];
      })
    : [];

/** Every link of a node: its own, and its runs' (ADR 0163). */
export const linksOfNode = (node: DesignNode): string[] => [
  ...(node.link === undefined || node.link === "" ? [] : [node.link]),
  ...runLinks(node),
];

/** The runs cut at a place in their words: those before it, and those after. */
const cutAt = (runs: readonly TextRun[], at: number) => {
  const before: TextRun[] = [];
  const after: TextRun[] = [];
  let start = 0;
  for (const run of runs) {
    const end = start + run.text.length;
    if (end <= at) {
      before.push(run);
    } else if (start >= at) {
      after.push(run);
    } else {
      before.push({ ...run, text: run.text.slice(0, at - start) });
      after.push({ ...run, text: run.text.slice(at - start) });
    }
    start = end;
  }
  return { after, before };
};

/** Whether a place in the runs' words falls inside one run's words, not at an edge between two. */
const insideARun = (runs: readonly TextRun[], at: number) => {
  let start = 0;
  for (const run of runs) {
    const end = start + run.text.length;
    if (at > start && at < end) {
      return true;
    }
    start = end;
  }
  return false;
};

/**
 * The runs once `removed` characters from `start` are replaced by `inserted`, as an edit typed in
 * place changes them. What is typed inside a run's words stays in it. At the edge between two
 * runs it joins the one before, unless that one links or is underlined and the one after does
 * not, or there is none after: typing on after a link writes plain words. A run whose words are
 * all deleted goes.
 */
export const spliceRuns = (
  runs: readonly TextRun[],
  start: number,
  removed: number,
  inserted: string
): TextRun[] => {
  const { before } = cutAt(runs, start);
  const { after } = cutAt(runs, start + removed);
  if (inserted === "") {
    return [...before, ...after];
  }
  const left = before.at(-1);
  const [right] = after;
  const joinsLeft =
    left !== undefined &&
    (insideARun(runs, start) ||
      isPlain(left) ||
      (right !== undefined && !isPlain(right)));
  if (joinsLeft) {
    before[before.length - 1] = { ...left, text: left.text + inserted };
  } else if (right !== undefined && (left === undefined || isPlain(right))) {
    after[0] = { ...right, text: inserted + right.text };
  } else {
    before.push({ text: inserted });
  }
  return [...before, ...after];
};

/** What one edit did to the words: `removed` characters from `start` replaced by `inserted`. */
export interface Splice {
  readonly inserted: string;
  readonly removed: number;
  readonly start: number;
}

/**
 * What changed the words from `before` to `after`: one stretch replaced, the characters typed
 * ending at the caret when it is known, so typing a letter beside the same letter is placed
 * where it was typed.
 */
export const spliceOf = (
  before: string,
  after: string,
  caret?: number
): Splice => {
  const common = (limit: number, at: (i: number) => [string?, string?]) => {
    let n = 0;
    while (n < limit) {
      const [a, b] = at(n);
      if (a !== b) {
        break;
      }
      n += 1;
    }
    return n;
  };
  const shortest = Math.min(before.length, after.length);
  const fromEnd = (i: number): [string?, string?] => [
    before.at(-1 - i),
    after.at(-1 - i),
  ];
  const fromStart = (i: number): [string?, string?] => [before[i], after[i]];
  let prefix: number;
  let suffix: number;
  if (caret === undefined) {
    prefix = common(shortest, fromStart);
    suffix = common(shortest - prefix, fromEnd);
  } else {
    // What follows the caret was not typed: the end the two share stops there.
    suffix = common(Math.min(after.length - caret, before.length), fromEnd);
    prefix = common(
      Math.min(caret, before.length - suffix, after.length - suffix),
      fromStart
    );
  }
  return {
    inserted: after.slice(prefix, after.length - suffix),
    removed: before.length - suffix - prefix,
    start: prefix,
  };
};

/** Past this many characters compared with as many, words changed are told as one splice. */
const MAX_COMPARED = 1_000_000;

/**
 * What changed the words from `before` to `after`, as the stretches replaced, last first, so
 * each applies to the words the ones before it left: the words both keep in order (their longest
 * common subsequence) stay, so changes on either side of a run leave it whole.
 */
export const splicesOf = (before: string, after: string): Splice[] => {
  const whole = spliceOf(before, after);
  const removed = before.slice(whole.start, whole.start + whole.removed);
  const { inserted } = whole;
  if (removed === "" || inserted === "") {
    return removed === "" && inserted === "" ? [] : [whole];
  }
  if (removed.length * inserted.length > MAX_COMPARED) {
    return [whole];
  }
  return splicesKeeping(removed, inserted, whole.start);
};

/**
 * How many characters `a` from `i` on and `b` from `j` on keep in common, in order, for every
 * `i` and `j`: the table a longest common subsequence is read from.
 */
const keptTable = (a: string, b: string) => {
  const width = b.length + 1;
  const kept = new Uint32Array((a.length + 1) * width);
  const keptAt = (x: number, y: number) => kept[x * width + y] ?? 0;
  for (let x = a.length - 1; x >= 0; x -= 1) {
    for (let y = b.length - 1; y >= 0; y -= 1) {
      kept[x * width + y] =
        a[x] === b[y]
          ? keptAt(x + 1, y + 1) + 1
          : Math.max(keptAt(x + 1, y), keptAt(x, y + 1));
    }
  }
  return keptAt;
};

/**
 * The stretches that turn `removed` into `inserted`, keeping what they share in order, placed
 * from `offset` on, last first.
 */
const splicesKeeping = (
  removed: string,
  inserted: string,
  offset: number
): Splice[] => {
  const keptAt = keptTable(removed, inserted);
  const splices: Splice[] = [];
  let open: { inserted: string; removed: number; start: number } | null = null;
  let i = 0;
  let j = 0;
  while (i < removed.length || j < inserted.length) {
    if (removed[i] !== undefined && removed[i] === inserted[j]) {
      if (open) {
        splices.push(open);
        open = null;
      }
      i += 1;
      j += 1;
      continue;
    }
    open ??= { inserted: "", removed: 0, start: offset + i };
    const insert =
      j < inserted.length &&
      (i === removed.length || keptAt(i, j + 1) >= keptAt(i + 1, j));
    if (insert) {
      open.inserted += inserted[j];
      j += 1;
    } else {
      open.removed += 1;
      i += 1;
    }
  }
  if (open) {
    splices.push(open);
  }
  return splices.reverse();
};

/**
 * A text's words and runs once its words are `words`: its runs, when it has some, following the
 * edits that made them (`splicesOf`), as the inspector's Text field writes them.
 */
export const reworded = (node: TextNode, words: string): TextWords => {
  if (!hasRuns(node)) {
    return { text: words };
  }
  const runs = splicesOf(wordsOfRuns(node.runs), words).reduce<TextRun[]>(
    (edited, { inserted, removed, start }) =>
      spliceRuns(edited, start, removed, inserted),
    [...node.runs]
  );
  return { runs: settleRuns(runs), text: words };
};

/** The runs over a stretch of words, cut at its edges. */
const runsIn = (runs: readonly TextRun[], { end, start }: WordsRange) =>
  cutAt(cutAt(runs, start).after, end - start).before;

/** The runs with `fields` set over a stretch of words; `null` takes one off. */
export const setOverRuns = (
  runs: readonly TextRun[],
  range: WordsRange,
  fields: {
    readonly link?: string | null | undefined;
    readonly underline?: boolean | null | undefined;
  }
): TextRun[] => {
  const { before } = cutAt(runs, range.start);
  const { after } = cutAt(runs, range.end);
  const set = runsIn(runs, range).map((run) => {
    const next: Record<string, unknown> = { ...run };
    for (const [key, value] of Object.entries(fields)) {
      if (value === null || value === false) {
        delete next[key];
      } else if (value !== undefined) {
        next[key] = value;
      }
    }
    return next as unknown as TextRun;
  });
  return [...before, ...set, ...after];
};

/** Whether every word of a stretch is underlined. */
export const underlinedThrough = (
  runs: readonly TextRun[],
  range: WordsRange
): boolean => {
  const within = runsIn(runs, range);
  return within.length > 0 && within.every((run) => run.underline === true);
};

/** Where every word of a stretch leads, when they all lead to the same place or nowhere. */
export const linkThrough = (
  runs: readonly TextRun[],
  range: WordsRange
): string | undefined => {
  const links = new Set(runsIn(runs, range).map(linkOf));
  return links.size === 1 ? [...links][0] : undefined;
};

/**
 * A text's words and runs once a stretch of its words leads to `link` (null: nowhere), as ⌘K's
 * "Goes to" sets them; null when nothing changes, or when the text links as a whole, whose words
 * cannot link too.
 */
export const linkWords = (
  node: TextNode,
  range: WordsRange,
  link: string | null
): TextWords | null => {
  if (node.link) {
    return null;
  }
  const runs = settleRuns(setOverRuns(runsOf(node), range, { link }));
  if (runs === null) {
    return node.runs ? { runs: null, text: node.text } : null;
  }
  return { runs, text: wordsOfRuns(runs) };
};

/** What a text's runs set, said for a person: `a link and an underline`, `2 links`. */
const whatRunsSet = (runs: readonly TextRun[]): string => {
  const links = runs.filter((run) => linkOf(run) !== undefined).length;
  const underlines = runs.filter((run) => run.underline).length;
  const counted = (n: number, one: string, many: string) =>
    n === 0 ? [] : [n === 1 ? one : `${n} ${many}`];
  return [
    ...counted(links, "a link", "links"),
    ...counted(underlines, "an underline", "underlines"),
  ].join(" and ");
};

/**
 * The texts whose runs an update took off by setting their `text` alone, each with what it lost:
 * what the answer to the operations says, as a field that did nothing is said.
 */
export const runsDropped = (
  found: readonly Found[],
  after: DesignNode
): { readonly message: string; readonly nodeId: string }[] =>
  found.flatMap(({ fields, layer, op }) => {
    if (op.op !== "update" || op.at !== undefined || layer !== undefined) {
      return [];
    }
    const had = isRecord(fields) ? fields.runs : undefined;
    const node = findNode(after, op.id);
    if (
      !("text" in op.set) ||
      "runs" in op.set ||
      !Array.isArray(had) ||
      node === null ||
      hasRuns(node)
    ) {
      return [];
    }
    return [
      {
        message: `text set alone took off its runs (${whatRunsSet(had as TextRun[])}): set runs with the words to keep them`,
        nodeId: op.id,
      },
    ];
  });
