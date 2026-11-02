/**
 * The one reading of a stylesheet the Tailwind v4 package shares: its blocks and declarations with
 * their offsets, quoted strings and parentheses respected (`url("data:…;…")` is one value), and how
 * Tailwind's theme treats `initial`. The design-system scan, the token reader and writer and the
 * usage scan all read CSS through it, so they agree; `var()` is followed by contracts'
 * `resolveVars`.
 */

/** A name a declaration is written to: a custom property, `--color-*` included, or a property. */
const NAME_RE = /^\s*(--[\w*-]*|-?[a-zA-Z][\w-]*)\s*:/;
const AT_STATEMENT_RE = /^\s*@([\w-]+)\s*/;
const NON_NEWLINE_RE = /[^\n]/g;

/** One declaration of a stylesheet, with where its value and the whole of it are written. */
export interface Declaration {
  /** Where the `{` of the block that holds it is: which block it is, among those of one prelude. */
  readonly block: number;
  /** Where the declaration starts and ends, its `;` included. */
  readonly declEnd: number;
  readonly declStart: number;
  /** As the caller named it: absolute for the files the token reader follows. */
  readonly file: string;
  /** `--color-primary`, `margin-top`. */
  readonly name: string;
  /** The at-rules and selectors that hold it, outermost first: `@theme inline`, `:root .card`. */
  readonly prelude: string;
  readonly value: string;
  readonly valueEnd: number;
  readonly valueStart: number;
}

/** A block of a stylesheet: where its `{` and `}` are, to add a declaration before the `}`. */
export interface Block {
  readonly close: number;
  readonly file: string;
  readonly open: number;
  readonly prelude: string;
}

/** An at-rule written as a statement inside a block, `@apply px-4 text-sm;`. */
interface AtStatement {
  readonly name: string;
  readonly params: string;
  readonly paramsStart: number;
  readonly prelude: string;
}

export interface Parsed {
  readonly blocks: Block[];
  readonly declarations: Declaration[];
  readonly statements: AtStatement[];
}

/** Where a quoted string that opens at `i` ends: the index of its closing quote. */
const stringEnd = (css: string, i: number): number => {
  const quote = css[i];
  let j = i + 1;
  while (j < css.length && css[j] !== quote) {
    j += css[j] === "\\" ? 2 : 1;
  }
  return j;
};

/**
 * The text with its comments blanked to spaces, its line breaks kept, so offsets and lines in the
 * result are those of the text. A `/*` inside a quoted string is not a comment.
 */
export const masked = (text: string): string => {
  let out = "";
  let from = 0;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\") {
      // An escaped character, `.it\'s`, is part of a name, and opens nothing.
      i += 2;
    } else if (char === '"' || char === "'") {
      i = stringEnd(text, i) + 1;
    } else if (char === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      const end = close === -1 ? text.length : close + 2;
      out +=
        text.slice(from, i) + text.slice(i, end).replace(NON_NEWLINE_RE, " ");
      from = end;
      i = end;
    } else {
      i += 1;
    }
  }
  return out + text.slice(from);
};

const SPACE_RE = /\s/;

/**
 * What is written between `start` and `end` as a reader takes it, the comments out: each one, and
 * the space around it, is one space, or none next to a parenthesis or a comma. `css` is `text`
 * masked: where the two differ, a comment is.
 */
const uncommented = (
  text: string,
  css: string,
  start: number,
  end: number
): string => {
  let out = "";
  let i = start;
  while (i < end) {
    if (css[i] === text[i]) {
      out += text[i];
      i += 1;
      continue;
    }
    out = out.trimEnd();
    while (i < end && (css[i] !== text[i] || SPACE_RE.test(css[i] ?? ""))) {
      i += 1;
    }
    const next = css[i];
    if (!(out.endsWith("(") || next === ")" || next === ",")) {
      out += " ";
    }
  }
  return out.trim();
};

/** The declaration written between `start` and `end`, if one is. */
const declarationAt = (
  file: string,
  text: string,
  css: string,
  span: { readonly end: number; readonly start: number; readonly stop: number },
  holder: { readonly open: number; readonly prelude: string }
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
    block: holder.open,
    declEnd: span.stop,
    declStart: span.start + (chunk.length - chunk.trimStart().length),
    file,
    name: named[1],
    prelude: holder.prelude,
    // Read without its comments; written over by its offsets, which take them along.
    value: uncommented(text, css, valueStart, valueEnd),
    valueEnd,
    valueStart,
  };
};

/** An at-rule statement written between `start` and `end`, if one is. */
const statementAt = (
  css: string,
  span: { readonly end: number; readonly start: number },
  prelude: string
): AtStatement | null => {
  const chunk = css.slice(span.start, span.end);
  const at: RegExpExecArray | null = AT_STATEMENT_RE.exec(chunk);
  if (!at?.[1]) {
    return null;
  }
  const paramsStart = span.start + at[0].length;
  // Its comments blanked, so an offset into it is still one into the text.
  const params = css.slice(paramsStart, span.start + chunk.trimEnd().length);
  return { name: at[1], params, paramsStart, prelude };
};

/** Every block, declaration and at-rule statement of a stylesheet, with their offsets. */
export const parseStylesheet = (file: string, text: string): Parsed => {
  const css = masked(text);
  const blocks: Block[] = [];
  const declarations: Declaration[] = [];
  const statements: AtStatement[] = [];
  const stack: { readonly open: number; readonly prelude: string }[] = [];
  let start = 0;
  let parens = 0;

  /** What sits between the last boundary and `at`, when it ends a declaration or a statement. */
  const end = (at: number, stop: number) => {
    const holder = stack.at(-1);
    if (holder !== undefined) {
      const span = { end: at, start, stop };
      const found = declarationAt(file, text, css, span, holder);
      const statement = found ? null : statementAt(css, span, holder.prelude);
      if (found) {
        declarations.push(found);
      } else if (statement) {
        statements.push(statement);
      }
    }
    start = at + 1;
  };

  /** A `{`, `;` or `}` outside any parentheses: a block opens, a declaration or a block ends. */
  const boundary = (char: string | undefined, at: number) => {
    if (char === "{") {
      const outer = stack.at(-1)?.prelude ?? "";
      stack.push({
        open: at,
        prelude: `${outer} ${css.slice(start, at).trim()}`.trim(),
      });
      start = at + 1;
    } else if (char === ";") {
      end(at, at + 1);
    } else if (char === "}") {
      end(at, at);
      const block = stack.pop();
      if (block !== undefined) {
        blocks.push({ close: at, file, ...block });
      }
    }
  };

  let i = 0;
  while (i < css.length) {
    const char = css[i];
    if (char === "\\") {
      // `.foo\(` and `.it\'s` are selectors: the escaped character opens nothing.
      i += 1;
    } else if (char === '"' || char === "'") {
      i = stringEnd(css, i);
    } else if (char === "(" || char === ")") {
      parens = Math.max(0, parens + (char === "(" ? 1 : -1));
    } else if (parens === 0) {
      boundary(char, i);
    }
    i += 1;
  }
  return { blocks, declarations, statements };
};

/**
 * The namespaces a reset leaves alone, as Tailwind has them: `--font-*: initial` clears the
 * families and keeps `--font-weight-*`, `--inset-*` keeps the inset shadows.
 */
const KEPT_BY_RESET: Readonly<Record<string, readonly string[]>> = {
  "--font": ["--font-weight", "--font-size"],
  "--grid-column": ["--grid-column-start", "--grid-column-end"],
  "--grid-row": ["--grid-row-start", "--grid-row-end"],
  "--inset": ["--inset-shadow", "--inset-ring"],
  "--text": [
    "--text-color",
    "--text-decoration-color",
    "--text-decoration-thickness",
    "--text-indent",
    "--text-shadow",
    "--text-underline-offset",
  ],
};

/** Whether a theme declaration set to `initial` takes `variable` out: `--color-*`, `--*`, itself. */
export const resetCovers = (reset: string, variable: string): boolean => {
  if (reset === "--*") {
    return true;
  }
  if (!reset.endsWith("-*")) {
    return variable === reset;
  }
  const namespace = reset.slice(0, -2);
  return (
    variable.startsWith(namespace) &&
    !(KEPT_BY_RESET[namespace] ?? []).some((kept) => variable.startsWith(kept))
  );
};

/** Whether a theme declaration is a reset rather than a value: `--color-*: initial`. */
export const isReset = (value: string) => value.trim() === "initial";

/**
 * One `@theme` declaration applied as Tailwind applies it, to variables by name: a reset takes
 * out what it covers, anything else sets the variable.
 */
export const applyThemeDeclaration = (
  vars: Map<string, string>,
  name: string,
  value: string
) => {
  if (isReset(value)) {
    for (const variable of [...vars.keys()]) {
      if (resetCovers(name, variable)) {
        vars.delete(variable);
      }
    }
  } else if (!name.includes("*")) {
    vars.set(name, value);
  }
};
