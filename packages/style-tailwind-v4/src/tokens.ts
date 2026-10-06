/**
 * Tailwind v4's tokens as the code declares them, and written back where they are declared
 * (ADR 0024). A token is a variable of an `@theme` block: `--color-primary: #2563eb`. The common
 * shadcn arrangement declares it as an alias, `--color-primary: var(--primary)` in `@theme
 * inline`, with the value in `:root` and `.dark`; the value is then read from, and written to,
 * the variable the alias names, once per theme.
 *
 * Reading follows the stylesheets the preview imports, as the scan does; Tailwind's own
 * `theme.css` gives the defaults, which are listed but never written.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  type FileEdit,
  type SourceToken,
  type TokenChange,
  type TokenOrigin,
  type TokenSource,
  tokenKindOf,
} from "@ultrapaint/contracts/tokens";
import type { DesignSystemContext } from "@ultrapaint/framework-api/node";
import { collect, hostEntries, themeOf } from "./design-system-scan.ts";

const COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const NAME_RE = /^\s*(--[\w-]+)\s*:/;
const ALIAS_RE = /^var\(\s*(--[\w-]+)\s*\)$/;
const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/;
/** A scope whose variables hold for the whole document: the default theme's. */
const ROOT_SCOPE_RE = /(^|[\s,])(:root|html|:host)\b/;
const NODE_MODULES_RE = /[\\/]node_modules[\\/]/;
const MAX_ALIAS_DEPTH = 8;

const toPosix = (p: string) => p.replaceAll("\\", "/");

/** The variable a value is an alias of, `var(--primary)`; undefined for anything else. */
const aliasOf = (value: string): string | undefined => {
  const match: RegExpExecArray | null = ALIAS_RE.exec(value);
  return match?.[1];
};

/** One `--name: value` of a stylesheet, with where its value and the whole of it are written. */
interface Declaration {
  /** Where the declaration starts and ends, its `;` included. */
  readonly declEnd: number;
  readonly declStart: number;
  /** Absolute. */
  readonly file: string;
  readonly name: string;
  readonly prelude: string;
  readonly value: string;
  readonly valueEnd: number;
  readonly valueStart: number;
}

/** A block of a stylesheet: where its `}` is, to add a declaration before it. */
interface Block {
  readonly close: number;
  /** Absolute. */
  readonly file: string;
  readonly prelude: string;
}

interface Parsed {
  readonly blocks: Block[];
  readonly declarations: Declaration[];
}

/** Comments blanked out, so offsets in the result are offsets in the text. */
const masked = (text: string) =>
  text.replace(COMMENT_RE, (comment) => " ".repeat(comment.length));

/** The declaration written between `start` and `end`, if it is a custom property. */
const declarationAt = (
  file: string,
  text: string,
  css: string,
  span: { readonly end: number; readonly start: number; readonly stop: number },
  prelude: string
): Declaration | null => {
  const chunk = css.slice(span.start, span.end);
  const named: RegExpExecArray | null = NAME_RE.exec(chunk);
  if (!named?.[1]) {
    return null;
  }
  const colon = span.start + named[0].length;
  const raw = css.slice(colon, span.end);
  const valueStart = colon + (raw.length - raw.trimStart().length);
  const valueEnd = colon + raw.trimEnd().length;
  if (valueEnd <= valueStart) {
    return null;
  }
  return {
    declEnd: span.stop,
    declStart: span.start + (chunk.length - chunk.trimStart().length),
    file,
    name: named[1],
    prelude,
    value: text.slice(valueStart, valueEnd),
    valueEnd,
    valueStart,
  };
};

/** Where a quoted string that opens at `i` ends: the index of its closing quote. */
const stringEnd = (css: string, i: number): number => {
  const quote = css[i];
  let j = i + 1;
  while (j < css.length && css[j] !== quote) {
    j += css[j] === "\\" ? 2 : 1;
  }
  return j;
};

/** Every custom property declaration and block of a stylesheet, with their offsets. */
export const parseStylesheet = (file: string, text: string): Parsed => {
  const css = masked(text);
  const blocks: Block[] = [];
  const declarations: Declaration[] = [];
  const stack: string[] = [];
  let start = 0;
  let parens = 0;

  /** What sits between the last boundary and `end`, when it ends a declaration. */
  const end = (at: number, stop: number) => {
    const prelude = stack.at(-1);
    const found =
      prelude === undefined
        ? null
        : declarationAt(file, text, css, { end: at, start, stop }, prelude);
    if (found) {
      declarations.push(found);
    }
    start = at + 1;
  };

  /** A `{`, `;` or `}` outside any parentheses: a block opens, a declaration or a block ends. */
  const boundary = (char: string | undefined, at: number) => {
    if (char === "{") {
      stack.push(`${stack.at(-1) ?? ""} ${css.slice(start, at).trim()}`.trim());
      start = at + 1;
    } else if (char === ";") {
      end(at, at + 1);
    } else if (char === "}") {
      end(at, at);
      const prelude = stack.pop();
      if (prelude !== undefined) {
        blocks.push({ close: at, file, prelude });
      }
    }
  };

  let i = 0;
  while (i < css.length) {
    const char = css[i];
    if (char === '"' || char === "'") {
      i = stringEnd(css, i);
    } else if (char === "(" || char === ")") {
      parens = Math.max(0, parens + (char === "(" ? 1 : -1));
    } else if (parens === 0) {
      boundary(char, i);
    }
    i += 1;
  }
  return { blocks, declarations };
};

const isTheme = (prelude: string) => prelude.includes("@theme");

/** The theme a block of plain variables gives values for: `""` for the default, or none. */
const themeKeyOf = (prelude: string): string | null => {
  const named = themeOf(prelude);
  if (named) {
    return named;
  }
  return ROOT_SCOPE_RE.test(prelude) ? "" : null;
};

/** A token's name from its variable; null for what is not a token of its own. */
const tokenNameOf = (variable: string): string | null => {
  const name = variable.slice(2);
  // `--text-xs--line-height` belongs to `text-xs`; `--color-*: initial` resets a namespace.
  if (name.includes("--") || name.includes("*") || name === "") {
    return null;
  }
  return name;
};

/** The declarations of the stylesheets, sorted into what reading and writing need. */
interface Declared {
  readonly blocks: Block[];
  /** The `@theme` declaration of each token, by name; the last one wins, as in CSS. */
  readonly declared: Map<string, Declaration>;
  /** Plain variables by theme (`""` the default), then by variable. */
  readonly scoped: Map<string, Map<string, Declaration>>;
}

const readFile = (file: string): string | null => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    // Listed by the imports and gone since: there is nothing to read.
    return null;
  }
};

const declarationsOf = (files: readonly string[]): Declared => {
  const out: Declared = {
    blocks: [],
    declared: new Map(),
    scoped: new Map(),
  };
  for (const file of files) {
    const text = readFile(file);
    if (text === null) {
      continue;
    }
    const parsed = parseStylesheet(file, text);
    out.blocks.push(...parsed.blocks);
    for (const decl of parsed.declarations) {
      const name = tokenNameOf(decl.name);
      const key = themeKeyOf(decl.prelude);
      if (isTheme(decl.prelude)) {
        if (name) {
          out.declared.set(name, decl);
        }
      } else if (key !== null) {
        const vars = out.scoped.get(key) ?? new Map<string, Declaration>();
        vars.set(decl.name, decl);
        out.scoped.set(key, vars);
      }
    }
  }
  return out;
};

/** Tailwind's own theme: the defaults, by token name, as written. */
const defaultsOf = (file: string | null): Map<string, string> => {
  const defaults = new Map<string, string>();
  const text = file ? readFile(file) : null;
  if (!(file && text)) {
    return defaults;
  }
  for (const decl of parseStylesheet(file, text).declarations) {
    const name = tokenNameOf(decl.name);
    if (name && isTheme(decl.prelude)) {
      defaults.set(name, decl.value);
    }
  }
  return defaults;
};

/** What the reading keeps beyond the tokens: what a write needs to find its place. */
interface Reading extends Declared {
  readonly source: TokenSource;
  /** The stylesheets the repository writes, absolute, in the order they are read. */
  readonly writable: string[];
}

/** Follows the `var()`s of a value through one theme's variables, then the default's. */
const resolverOf =
  (found: Declared, defaults: ReadonlyMap<string, string>) =>
  (value: string, theme: string): string => {
    let out = value;
    for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth += 1) {
      const match: RegExpExecArray | null = VAR_RE.exec(out);
      if (!match) {
        return out;
      }
      const [whole, variable = "", fallback] = match;
      const name = tokenNameOf(variable) ?? "";
      const next =
        found.scoped.get(theme)?.get(variable)?.value ??
        found.scoped.get("")?.get(variable)?.value ??
        found.declared.get(name)?.value ??
        defaults.get(name) ??
        fallback?.trim();
      if (next === undefined) {
        return out;
      }
      out = out.replace(whole, next);
    }
    return out;
  };

const read = (ctx: DesignSystemContext): Reading => {
  const entries = hostEntries(ctx);
  const found = collect(entries, ctx.anchorDir);
  const notes =
    entries.length === 0
      ? [
          "No stylesheet is configured for the preview, so no token could be read.",
        ]
      : [];
  const inside = path.resolve(ctx.root) + path.sep;
  const writable = found.files.filter(
    (file) =>
      !NODE_MODULES_RE.test(file) && path.resolve(file).startsWith(inside)
  );
  const declared = declarationsOf(found.files);
  const defaults = defaultsOf(found.tailwindTheme);
  const resolve = resolverOf(declared, defaults);
  const themes = [...declared.scoped.keys()].filter((k) => k !== "");
  const relative = (file: string) => toPosix(path.relative(ctx.root, file));

  /** The value and where it is written, in each theme, of the variable that holds it. */
  const valuesOf = (variable: string, fallback: Declaration | undefined) => {
    const origins: Record<string, TokenOrigin> = {};
    const values: Record<string, string> = {};
    const at = (theme: string, decl: Declaration) => {
      if (writable.includes(decl.file)) {
        origins[theme] = {
          end: decl.valueEnd,
          file: relative(decl.file),
          start: decl.valueStart,
        };
      }
    };
    const base = declared.scoped.get("")?.get(variable) ?? fallback;
    if (base) {
      at("", base);
    }
    for (const theme of themes) {
      const own = declared.scoped.get(theme)?.get(variable);
      if (own) {
        values[theme] = resolve(own.value, theme);
        at(theme, own);
      }
    }
    return { base, origins, values };
  };

  const tokenOf = (name: string, decl: Declaration): SourceToken => {
    const alias = aliasOf(decl.value);
    // `--color-primary: var(--primary)`: the value is the variable's, theme by theme. Else a
    // theme may declare the token's variable again, `.dark { --color-primary: … }`.
    const variable =
      alias && declared.scoped.get("")?.has(alias) ? alias : decl.name;
    const { base, origins, values } = valuesOf(
      variable,
      variable === decl.name ? decl : undefined
    );
    return {
      kind: tokenKindOf(name),
      name,
      ...(Object.keys(origins).length > 0 && { origins }),
      own: true,
      value: resolve((base ?? decl).value, ""),
      ...(Object.keys(values).length > 0 && { values }),
    };
  };

  const tokens: SourceToken[] = [...declared.declared].map(([name, decl]) =>
    tokenOf(name, decl)
  );
  for (const [name, raw] of defaults) {
    if (!declared.declared.has(name)) {
      tokens.push({
        kind: tokenKindOf(name),
        name,
        own: false,
        value: resolve(raw, ""),
      });
    }
  }
  return {
    ...declared,
    source: { files: found.files.map(relative), notes, themes, tokens },
    writable,
  };
};

export const readTokens = (ctx: DesignSystemContext): TokenSource =>
  read(ctx).source;

/** A change to one file: the text between `start` and `end` replaced. */
interface Splice {
  readonly end: number;
  readonly start: number;
  readonly text: string;
}

/** The selector a theme's values are written under when it has no block yet. */
const selectorOf = (theme: string) =>
  theme === "dark" ? ".dark" : `[data-theme="${theme}"]`;

/** Where a declaration goes in a block: on a line of its own before the `}`, indented. */
const insertion = (text: string, block: Block, line: string): Splice => {
  const lineStart = text.lastIndexOf("\n", block.close - 1) + 1;
  if (text.slice(lineStart, block.close).trim() === "") {
    // The `}` is on a line of its own.
    return { end: lineStart, start: lineStart, text: `  ${line}\n` };
  }
  return { end: block.close, start: block.close, text: ` ${line} ` };
};

/** The whole line a declaration is on, when it is alone on it; else just the declaration. */
const removal = (text: string, decl: Declaration): Splice => {
  const lineStart = text.lastIndexOf("\n", decl.declStart - 1) + 1;
  const newline = text.indexOf("\n", decl.declEnd);
  const lineEnd = newline === -1 ? text.length : newline + 1;
  const alone =
    text.slice(lineStart, decl.declStart).trim() === "" &&
    text.slice(decl.declEnd, lineEnd).trim() === "";
  return alone
    ? { end: lineEnd, start: lineStart, text: "" }
    : { end: decl.declEnd, start: decl.declStart, text: "" };
};

/** Edits gathered file by file, then applied from the end of each file back. */
const editor = (root: string) => {
  const texts = new Map<string, string>();
  const splices = new Map<string, Splice[]>();
  const appended = new Map<string, string>();
  const textOf = (file: string) => {
    const known = texts.get(file) ?? readFile(file) ?? "";
    texts.set(file, known);
    return known;
  };
  return {
    /** Text appended to a file: a block it did not have. */
    append: (file: string, css: string) =>
      appended.set(file, `${appended.get(file) ?? ""}${css}`),
    done: (): FileEdit[] =>
      [...new Set([...splices.keys(), ...appended.keys()])].map((file) => {
        let text = textOf(file);
        const ordered = [...(splices.get(file) ?? [])].sort(
          (a, b) => b.start - a.start
        );
        for (const s of ordered) {
          text = text.slice(0, s.start) + s.text + text.slice(s.end);
        }
        return {
          file: toPosix(path.relative(root, file)),
          text: text + (appended.get(file) ?? ""),
        };
      }),
    splice: (file: string, make: (text: string) => Splice) =>
      splices.set(file, [...(splices.get(file) ?? []), make(textOf(file))]),
  };
};

export const writeTokens = (
  ctx: DesignSystemContext,
  changes: readonly TokenChange[]
): FileEdit[] => {
  const reading = read(ctx);
  const edits = editor(ctx.root);
  const writable = (decl: Declaration | undefined): decl is Declaration =>
    decl !== undefined && reading.writable.includes(decl.file);
  const ownBlocks = reading.blocks.filter((b) =>
    reading.writable.includes(b.file)
  );
  const themeBlock =
    ownBlocks.find(
      (b) => isTheme(b.prelude) && !b.prelude.includes("inline")
    ) ?? ownBlocks.find((b) => isTheme(b.prelude));
  const [firstFile] = reading.writable;

  /** Adds a declaration to a theme's block, or a block made for it. */
  const add = (theme: string, line: string) => {
    const block =
      theme === ""
        ? themeBlock
        : ownBlocks.find(
            (b) => !isTheme(b.prelude) && themeKeyOf(b.prelude) === theme
          );
    if (block) {
      edits.splice(block.file, (text) => insertion(text, block, line));
    } else if (firstFile) {
      const selector = theme === "" ? "@theme" : selectorOf(theme);
      edits.append(firstFile, `\n${selector} {\n  ${line}\n}\n`);
    }
  };

  /** The variable a change writes, and where this theme's value of it is written now. */
  const targetOf = (change: TokenChange) => {
    const theme = change.theme ?? "";
    const decl = reading.declared.get(change.name);
    const alias = decl ? aliasOf(decl.value) : undefined;
    const variable =
      alias && reading.scoped.get("")?.has(alias) ? alias : `--${change.name}`;
    const target =
      theme === "" && variable === `--${change.name}`
        ? decl
        : reading.scoped.get(theme)?.get(variable);
    return { decl, target, theme, variable };
  };

  for (const change of changes) {
    const { decl, target, theme, variable } = targetOf(change);
    const { remove, value } = change;
    const gone = theme === "" ? decl : target;
    if (remove && writable(gone)) {
      edits.splice(gone.file, (text) => removal(text, gone));
    } else if (!remove && value !== undefined && writable(target)) {
      edits.splice(target.file, () => ({
        end: target.valueEnd,
        start: target.valueStart,
        text: value,
      }));
    } else if (!remove && value !== undefined) {
      add(theme, `${variable}: ${value};`);
    }
  }
  return edits.done();
};
