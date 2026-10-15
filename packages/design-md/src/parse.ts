/**
 * Reading a DESIGN.md: its tokens and its sections. Tokens are in the YAML front matter, or in
 * fenced `yaml` blocks of the body, which the format's own linter reads too; a group given in
 * two of them is an error, as it is there. The text is kept, and every part points into it, so
 * a rewrite touches only what changed.
 */
import { type Document, isMap, isScalar, parseDocument } from "yaml";
import { type SectionName, sectionOf } from "./format.ts";

/** A YAML block of tokens: the front matter or a fenced `yaml` block. */
export interface TokenBlock {
  readonly doc: Document;
  /** Where the YAML is in the text: after the opening line, before the closing one. */
  readonly end: number;
  readonly kind: "fence" | "front-matter";
  readonly start: number;
}

/** A `##` section of the body. */
export interface Section {
  /** Where the section ends: the next `##` heading, or the end of the text. */
  readonly end: number;
  readonly heading: string;
  /** The format's section the heading names, null for one it does not know. */
  readonly section: SectionName | null;
  /** Where the heading's line starts. */
  readonly start: number;
  /** What is under the heading, without it. */
  readonly text: string;
}

export interface DesignMd {
  readonly blocks: readonly TokenBlock[];
  /** Where the body starts: after the front matter's closing line, 0 when there is none. */
  readonly body: number;
  /** The block each top-level key is in, by key. */
  readonly keys: ReadonlyMap<string, number>;
  /** What is wrong with it, in words a person can act on. */
  readonly problems: readonly string[];
  readonly sections: readonly Section[];
  readonly text: string;
  /** The `#` heading above the first section, when there is one. */
  readonly title: string | null;
  /** Every top-level key's value, from whichever block holds it. */
  readonly values: Readonly<Record<string, unknown>>;
}

const FRONT_OPEN_RE = /^﻿?---[ \t]*\r?\n/;
const FRONT_CLOSE_RE = /^---[ \t]*$/m;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/;
const SECTION_RE = /^ {0,3}##[ \t]+(.+?)[ \t#]*$/;
const TITLE_RE = /^ {0,3}#[ \t]+(.+?)[ \t#]*$/;
const EOL_RE = /\r?\n$/;
const YAML_LANGS = new Set(["yaml", "yml"]);

interface Line {
  readonly end: number;
  readonly start: number;
  readonly text: string;
}

const linesOf = (text: string, from: number): Line[] => {
  const lines: Line[] = [];
  let start = from;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline + 1;
    lines.push({
      end,
      start,
      text: text.slice(start, end).replace(EOL_RE, ""),
    });
    start = end;
  }
  return lines;
};

const frontMatterOf = (
  text: string,
  problems: string[]
): { readonly body: number; readonly block: TokenBlock | null } => {
  // Typed by hand: the linter otherwise takes the result for non-null.
  const open: RegExpExecArray | null = FRONT_OPEN_RE.exec(text);
  if (open === null) {
    return { block: null, body: 0 };
  }
  const start = open[0].length;
  const close: RegExpExecArray | null = FRONT_CLOSE_RE.exec(text.slice(start));
  if (close === null) {
    problems.push("The front matter opens with --- and is never closed.");
    return { block: null, body: 0 };
  }
  const end = start + close.index;
  const after = text.indexOf("\n", end);
  return {
    block: {
      doc: parseDocument(text.slice(start, end)),
      end,
      kind: "front-matter",
      start,
    },
    body: after < 0 ? text.length : after + 1,
  };
};

/** The first group of `re` in `text`. */
const captureOf = (re: RegExp, text: string): string | undefined => {
  // Typed by hand: the linter otherwise takes the result for non-null.
  const match: RegExpExecArray | null = re.exec(text);
  return match === null ? undefined : match[1];
};

interface Fence {
  readonly char: string;
  readonly length: number;
  readonly yaml: boolean;
  readonly yamlStart: number;
}

/** Whether a line closes the fence: the same marker, at least as long, and nothing after it. */
const closes = (fence: Fence, marker: string | undefined, line: string) =>
  marker !== undefined &&
  marker[0] === fence.char &&
  marker.length >= fence.length &&
  line.trim() === marker;

/** The body's fenced `yaml` blocks, `##` sections and `#` title, outside other fences. */
const bodyOf = (text: string, from: number) => {
  const blocks: TokenBlock[] = [];
  const headings: { heading: string; start: number; textStart: number }[] = [];
  let title: string | null = null;
  let fence: Fence | null = null;
  for (const line of linesOf(text, from)) {
    const fenceMatch: RegExpExecArray | null = FENCE_RE.exec(line.text);
    const [, marker, lang = ""] = fenceMatch ?? [];
    if (fence) {
      if (closes(fence, marker, line.text)) {
        if (fence.yaml) {
          blocks.push({
            doc: parseDocument(text.slice(fence.yamlStart, line.start)),
            end: line.start,
            kind: "fence",
            start: fence.yamlStart,
          });
        }
        fence = null;
      }
      continue;
    }
    if (marker !== undefined) {
      fence = {
        char: marker[0] ?? "`",
        length: marker.length,
        yaml: YAML_LANGS.has(lang.toLowerCase()),
        yamlStart: line.end,
      };
      continue;
    }
    const section = captureOf(SECTION_RE, line.text);
    if (section !== undefined) {
      headings.push({
        heading: section,
        start: line.start,
        textStart: line.end,
      });
      continue;
    }
    const heading = captureOf(TITLE_RE, line.text);
    if (heading !== undefined && title === null && headings.length === 0) {
      title = heading;
    }
  }
  const sections = headings.map((h, i): Section => {
    const end = headings[i + 1]?.start ?? text.length;
    return {
      end,
      heading: h.heading,
      section: sectionOf(h.heading),
      start: h.start,
      text: text.slice(h.textStart, end),
    };
  });
  return { blocks, sections, title };
};

const where = (block: TokenBlock) =>
  block.kind === "front-matter" ? "the front matter" : "a yaml block";

/** A DESIGN.md read: its token blocks, merged, and its sections. Never fails; see `problems`. */
export const parse = (text: string): DesignMd => {
  const problems: string[] = [];
  const front = frontMatterOf(text, problems);
  const body = bodyOf(text, front.body);
  const blocks = front.block ? [front.block, ...body.blocks] : body.blocks;

  const keys = new Map<string, number>();
  const values: Record<string, unknown> = {};
  blocks.forEach((block, index) => {
    const [error] = block.doc.errors;
    if (error) {
      problems.push(
        `The YAML of ${where(block)} does not read: ${error.message}`
      );
      return;
    }
    const { contents } = block.doc;
    if (contents === null) {
      return;
    }
    if (!isMap(contents)) {
      problems.push(`${where(block)} is not a map of keys to tokens.`);
      return;
    }
    const js = block.doc.toJS() as Record<string, unknown>;
    for (const pair of contents.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : null;
      if (key === null) {
        continue;
      }
      const before = keys.get(key);
      const previous = before === undefined ? undefined : blocks[before];
      if (previous) {
        problems.push(
          `\`${key}\` is given in both ${where(previous)} and ${where(block)}.`
        );
        continue;
      }
      keys.set(key, index);
      values[key] = js[key];
    }
  });

  const seen = new Set<SectionName>();
  for (const section of body.sections) {
    if (section.section === null) {
      continue;
    }
    if (seen.has(section.section)) {
      problems.push(
        `There are two ${section.section} sections; the format allows one.`
      );
    }
    seen.add(section.section);
  }

  return {
    blocks,
    body: front.body,
    keys,
    problems,
    sections: body.sections,
    text,
    title: body.title,
    values,
  };
};
