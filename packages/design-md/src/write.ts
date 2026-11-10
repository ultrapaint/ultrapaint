/**
 * Writing a DESIGN.md (ADR 0027). The mirrored groups are the code's and are rewritten where
 * they are, front matter or yaml block; everything else — other keys, comments, the body — is
 * the file's authors' and stays byte for byte. A file whose groups already say what the code
 * says comes back unchanged.
 */
import { Document, isMap, isScalar, type YAMLMap } from "yaml";
import {
  FORMAT_VERSION,
  KEY_ORDER,
  MIRRORED_GROUPS,
  type MirroredGroup,
  SECTIONS,
  type TokenGroups,
} from "./format.ts";
import { type DesignMd, parse, type TokenBlock, UNCLOSED } from "./parse.ts";
import { follow, groupsOf, refOf } from "./tokens.ts";

const LEADING_BLANK_RE = /^\uFEFF?\s*\n/;
const EOL_RE = /\r?\n/;
const TO_STRING = { lineWidth: 0 } as const;
const EMPTY_MAP = "{}\n";

/** A block's YAML as it is written, its lines ended as `eol` says; nothing for one left without a key. */
const yamlOf = (doc: Document, eol: string): string => {
  const yaml = doc.toString(TO_STRING);
  if (yaml === EMPTY_MAP) {
    return "";
  }
  return eol === "\n" ? yaml : yaml.replaceAll("\n", eol);
};

/** How the line that ends at `at` ends: a block is written as the line that opens it is. */
const eolBefore = (text: string, at: number): string =>
  text.slice(at - 2, at) === "\r\n" ? "\r\n" : "\n";

/** How the file's first line ends: a front matter added above it is written the same. */
const firstEol = (text: string): string => {
  // Typed by hand: the linter otherwise takes the result for non-null.
  const first: RegExpExecArray | null = EOL_RE.exec(text);
  return first?.[0] ?? "\n";
};

type Entry = TokenGroups[MirroredGroup][string];

const sameEntry = (
  doc: DesignMd,
  current: Entry | undefined,
  wanted: Entry
): boolean => {
  if (current === undefined) {
    return false;
  }
  if (typeof current !== "object" || typeof wanted !== "object") {
    // A reference that comes to the code's value says the same, and is kept.
    const ref = refOf(current);
    const value = ref === null ? current : follow(doc.values, ref);
    return String(value) === String(wanted);
  }
  const a = Object.entries(current).filter(([, v]) => v !== undefined);
  const b = Object.entries(wanted).filter(([, v]) => v !== undefined);
  return (
    a.length === b.length &&
    b.every(([k, v]) => (current as Record<string, unknown>)[k] === v)
  );
};

const keyOf = (node: unknown): string | null =>
  isScalar(node) ? String(node.value) : null;

/** Where a key that is not there goes: after the last key the format orders before it. */
const insertAt = (map: YAMLMap, key: string): number => {
  const rank = (k: string | null) =>
    KEY_ORDER.indexOf((k ?? "") as (typeof KEY_ORDER)[number]);
  const wanted = rank(key);
  let at = 0;
  map.items.forEach((pair, i) => {
    const r = rank(keyOf(pair.key));
    if (r >= 0 && r < wanted) {
      at = i + 1;
    }
  });
  return at;
};

const rootMap = (doc: Document): YAMLMap | null => {
  if (doc.contents === null) {
    doc.contents = doc.createNode({}) as YAMLMap;
  }
  return isMap(doc.contents) ? doc.contents : null;
};

/** One group of a block's YAML made to say `wanted`, entry by entry. */
const writeGroup = (
  doc: Document,
  group: MirroredGroup,
  current: Readonly<Record<string, Entry>>,
  wanted: Readonly<Record<string, Entry>>,
  same: (current: Entry | undefined, wanted: Entry) => boolean
) => {
  const root = rootMap(doc);
  if (!root) {
    return;
  }
  if (Object.keys(wanted).length === 0) {
    doc.delete(group);
    return;
  }
  if (!isMap(doc.get(group))) {
    doc.delete(group);
    root.items.splice(insertAt(root, group), 0, doc.createPair(group, wanted));
    return;
  }
  const map = doc.get(group) as YAMLMap;
  // By the key's own node: YAML reads `2:` as a number, which the string "2" does not find.
  for (const pair of [...map.items]) {
    const key = keyOf(pair.key);
    if (key !== null && !(key in wanted)) {
      map.delete(pair.key);
    }
  }
  for (const [key, value] of Object.entries(wanted)) {
    if (!same(current[key], value)) {
      const pair = map.items.find((p) => keyOf(p.key) === key);
      map.set(pair?.key ?? key, doc.createNode(value));
    }
  }
};

/** Why a group cannot be written in the block it goes in (none: a new front matter), or null. */
const refusalOf = (
  doc: DesignMd,
  group: MirroredGroup,
  block: TokenBlock | null
): string | null => {
  if (block === null) {
    // A front matter added above one that never closes would leave the file with two.
    return doc.unclosed
      ? `${UNCLOSED.slice(0, -1)}, so ${group} cannot be written in it.`
      : null;
  }
  const [error] = block.doc.errors;
  if (error) {
    return `The YAML that holds ${group} does not read, so it cannot be rewritten: ${error.message}`;
  }
  const { contents } = block.doc;
  return contents === null || isMap(contents)
    ? null
    : `The front matter is not a map of keys to tokens, so ${group} cannot be written in it.`;
};

export type WriteResult =
  | { readonly changed: boolean; readonly text: string }
  | { readonly problem: string };

/**
 * The file with its mirrored groups saying what `groups` say. Groups stay in the block they are
 * in; one not given anywhere goes in the front matter, which is added when there is none.
 */
export const withMirror = (text: string, groups: TokenGroups): WriteResult => {
  const doc = parse(text);
  const typed = groupsOf(doc).groups;
  const front = doc.blocks.find((b) => b.kind === "front-matter") ?? null;
  const fresh = front ? null : new Document({});
  const dirty = new Set<TokenBlock | null>();

  for (const group of MIRRORED_GROUPS) {
    const current = typed[group] as Readonly<Record<string, Entry>>;
    const wanted = groups[group] as Readonly<Record<string, Entry>>;
    const same = (c: Entry | undefined, w: Entry) => sameEntry(doc, c, w);
    const unchanged =
      Object.keys(current).length === Object.keys(wanted).length &&
      Object.entries(wanted).every(([k, v]) => same(current[k], v)) &&
      // What groupsOf left out as unreadable is there to be rewritten.
      Object.keys(
        (doc.values[group] as Record<string, unknown> | undefined) ?? {}
      ).length === Object.keys(current).length;
    if (unchanged) {
      continue;
    }
    const index = doc.keys.get(group);
    const block = index === undefined ? front : (doc.blocks[index] ?? null);
    const problem = refusalOf(doc, group, block);
    if (problem !== null) {
      return { problem };
    }
    const target = block ? block.doc : fresh;
    if (!target) {
      continue;
    }
    writeGroup(target, group, current, wanted, same);
    dirty.add(block);
  }

  if (dirty.size === 0) {
    return { changed: false, text };
  }
  let out = text;
  const blocks = [...dirty]
    .filter((b): b is TokenBlock => b !== null)
    .sort((a, b) => b.start - a.start);
  for (const block of blocks) {
    const yaml = yamlOf(block.doc, eolBefore(text, block.start));
    out = `${out.slice(0, block.start)}${yaml}${out.slice(block.end)}`;
  }
  if (fresh && dirty.has(null)) {
    const eol = firstEol(text);
    out = `---${eol}${yamlOf(fresh, eol)}---${eol}${eol}${out.replace(LEADING_BLANK_RE, "")}`;
  }
  return { changed: out !== text, text: out };
};

/** A first DESIGN.md: the front matter and the format's sections, empty, in their order. */
export const create = (
  groups: TokenGroups,
  about: { readonly description?: string; readonly name: string }
): string => {
  // In the format's order: a list of pairs, which the formatter does not sort as it does keys.
  const front: [string, unknown][] = [
    ["version", FORMAT_VERSION],
    ["name", about.name],
  ];
  if (about.description !== undefined) {
    front.push(["description", about.description]);
  }
  for (const group of MIRRORED_GROUPS) {
    if (Object.keys(groups[group]).length > 0) {
      front.push([group, groups[group]]);
    }
  }
  const yaml = new Document(new Map(front)).toString(TO_STRING);
  const body = SECTIONS.map((s) => `## ${s.name}\n`).join("\n");
  return `---\n${yaml}---\n\n${body}`;
};

const REF_RE = /\{([^{}\s]+)\}/g;

/**
 * Every `{colors.a}` reference renamed as `renames` says, by path, in the front matter and the
 * body alike: after a match puts the code's names in the file (ADR 0027).
 */
export const renameRefs = (
  text: string,
  renames: ReadonlyMap<string, string>
): string =>
  text.replace(REF_RE, (whole, path: string) => {
    const to = renames.get(path);
    return to === undefined ? whole : `{${to}}`;
  });

/**
 * The file with one `##` section saying `body`: the section the format calls `name` (or the one
 * headed so), its text replaced; when there is none, added where the format orders it. The rest of
 * the file stays as it is.
 */
export const withSection = (
  text: string,
  name: string,
  body: string
): string => {
  const doc = parse(text);
  const block = `${body.trim()}\n`;
  const found = doc.sections.find(
    (s) => s.section === name || s.heading === name
  );
  if (found) {
    const newline = text.indexOf("\n", found.start);
    // A heading that ends the file without a line break gets one.
    const head = newline < 0 ? `${text}\n` : text.slice(0, newline + 1);
    const next = found.end < text.length ? "\n" : "";
    return `${head}\n${block}${next}${text.slice(found.end)}`;
  }
  const order = SECTIONS.findIndex((s) => s.name === name);
  const after = doc.sections.find((s) => {
    const at = SECTIONS.findIndex((x) => x.name === s.section);
    return order !== -1 && at > order;
  });
  const section = `## ${name}\n\n${block}`;
  if (after) {
    return `${text.slice(0, after.start)}${section}\n${text.slice(after.start)}`;
  }
  const head = text.endsWith("\n") || text === "" ? text : `${text}\n`;
  return `${head}${head.endsWith("\n\n") || head === "" ? "" : "\n"}${section}`;
};
