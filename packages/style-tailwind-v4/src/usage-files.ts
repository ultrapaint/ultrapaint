/**
 * The uses one file of the application's code makes, read by fixed rules: every string of a
 * script, as Tailwind reads it for classes, its inline styles, and a
 * stylesheet's declarations and `@apply` outside the theme.
 */
import { parse } from "@babel/parser";
import type { UsageOccurrence } from "@ultrapaint/framework-api/node";
import { parseStylesheet } from "./stylesheet.ts";
import { readClass } from "./usage-class.ts";
import { HEX_RE, isColorLiteral } from "./usage-vocabulary.ts";

const SOURCE_RE = /\.(tsx|jsx|ts|js|mjs|css)$/;
const SKIPPED_FILE_RE =
  /\.(test|spec|stories|story|config|d)\.[cm]?[jt]sx?$|\.min\.(js|css)$/;
const SKIPPED_DIR_RE =
  /(^|\/)(node_modules|dist|build|out|coverage|public|vendor|storybook-static|__tests__|__mocks__|\.[^/]+)\//;
const WORD_RE = /\S+/g;

export const includes = (file: string) =>
  SOURCE_RE.test(file) &&
  !SKIPPED_FILE_RE.test(file) &&
  !SKIPPED_DIR_RE.test(`/${file}`);

/** The line of each offset of a text, found by halving the list of where its lines start. */
const lineIndex = (text: string) => {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    starts.push(i + 1);
  }
  return (offset: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((starts[mid] ?? 0) <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low + 1;
  };
};

/** Where a piece of a string is in the file, when the string is written there as it reads. */
const spanIn = (base: number | null, index: number, length: number) =>
  base === null ? {} : { end: base + index + length, start: base + index };

/**
 * The classes and colour literals of one string of a source file. `base` is where the string's
 * text starts in the file, or null when it is not written there as it reads (an escape).
 */
const fromString = (
  value: string,
  line: number,
  out: UsageOccurrence[],
  base: number | null = null
) => {
  // A colour on its own, `rgb(0 0 0 / 50%)` included; inside a class it is the class's.
  const whole = value.trim();
  if (whole.includes("(") && isColorLiteral(whole)) {
    out.push({
      line,
      raw: whole,
      use: "literal",
      value: whole,
      ...spanIn(base, value.indexOf(whole), whole.length),
    });
    return;
  }
  for (const match of value.matchAll(WORD_RE)) {
    const [word] = match;
    const where = spanIn(base, match.index, word.length);
    if (HEX_RE.test(word) || (word.includes("(") && isColorLiteral(word))) {
      out.push({ line, raw: word, use: "literal", value: word, ...where });
      continue;
    }
    const read = readClass(word);
    if (read) {
      out.push({ line, raw: word, ...read, ...where });
    }
  }
};

interface AstNode {
  readonly loc?: { readonly start: { readonly line: number } };
  readonly type: string;
  readonly [key: string]: unknown;
}

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";

/** Type annotations hold strings that are types, not classes; imports hold module names. */
const SKIPPED_NODES = new Set([
  "ExportAllDeclaration",
  "ImportDeclaration",
  "TSEnumDeclaration",
  "TSInterfaceDeclaration",
  "TSLiteralType",
  "TSTypeAliasDeclaration",
  "TSTypeAnnotation",
]);
const SKIPPED_KEYS = new Set([
  "innerComments",
  "leadingComments",
  "loc",
  "trailingComments",
]);

const childrenOf = (node: AstNode): AstNode[] => {
  const out: AstNode[] = [];
  for (const key of Object.keys(node)) {
    if (SKIPPED_KEYS.has(key)) {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          out.push(item);
        }
      }
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out;
};

const lineOf = (node: AstNode) => node.loc?.start.line ?? 0;

/** Where a node is in the file. */
const spanOf = (node: AstNode) =>
  typeof node.start === "number" && typeof node.end === "number"
    ? { end: node.end, start: node.start }
    : {};

/** Where a string's text starts in the file, when it is written there as it reads. */
const textStart = (
  node: AstNode,
  text: string,
  value: string,
  quoted: boolean
): number | null => {
  if (typeof node.start !== "number" || typeof node.end !== "number") {
    return null;
  }
  const from = quoted ? node.start + 1 : node.start;
  const to = quoted ? node.end - 1 : node.end;
  return text.slice(from, to) === value ? from : null;
};

const nameOf = (node: unknown): string | null => {
  if (!isNode(node)) {
    return null;
  }
  if (node.type === "Identifier" || node.type === "JSXIdentifier") {
    return node.name as string;
  }
  if (node.type === "StringLiteral") {
    return node.value as string;
  }
  return null;
};

/** A style property's value when it is written out: a string, a number, `-16` included. */
const styleValueOf = (value: AstNode): string | null => {
  if (value.type === "StringLiteral") {
    return value.value as string;
  }
  if (value.type === "NumericLiteral") {
    return String(value.value);
  }
  const { argument } = value;
  return value.type === "UnaryExpression" &&
    value.operator === "-" &&
    isNode(argument) &&
    argument.type === "NumericLiteral"
    ? `-${String(argument.value)}`
    : null;
};

/** A JSX `style={{ … }}`: each property with a value written out. */
const fromStyle = (object: AstNode, out: UsageOccurrence[]) => {
  for (const property of (object.properties as unknown[] | undefined) ?? []) {
    if (!isNode(property) || property.type !== "ObjectProperty") {
      continue;
    }
    const key = nameOf(property.key);
    const { value } = property;
    if (!(key && isNode(value))) {
      continue;
    }
    const written = styleValueOf(value);
    if (written === null) {
      continue;
    }
    out.push({
      line: lineOf(property),
      raw: `style ${key}: ${written}`,
      use: `style:${key}`,
      value: written,
      ...spanOf(value),
      ...(value.type !== "StringLiteral" && { numeric: true }),
    });
  }
};

/** The object of a JSX `style={{ … }}` attribute. */
const styleObjectOf = (node: AstNode): AstNode | null => {
  if (node.type !== "JSXAttribute" || nameOf(node.name) !== "style") {
    return null;
  }
  const container = node.value;
  if (!isNode(container) || container.type !== "JSXExpressionContainer") {
    return null;
  }
  const { expression } = container;
  return isNode(expression) && expression.type === "ObjectExpression"
    ? expression
    : null;
};

/** The strings of one node, its children aside. */
const fromNode = (node: AstNode, text: string, out: UsageOccurrence[]) => {
  if (node.type === "StringLiteral") {
    const value = node.value as string;
    fromString(value, lineOf(node), out, textStart(node, text, value, true));
  } else if (node.type === "TemplateElement") {
    const quasi = node.value as { cooked?: string | null; raw: string };
    const value = quasi.cooked ?? quasi.raw;
    fromString(value, lineOf(node), out, textStart(node, text, value, false));
  }
};

const fromScript = (text: string): UsageOccurrence[] => {
  let ast: unknown;
  try {
    ast = parse(text, {
      errorRecovery: true,
      plugins: ["jsx", "typescript"],
      sourceType: "module",
    });
  } catch {
    // A file Babel cannot read at all uses nothing this can tell.
    return [];
  }
  const out: UsageOccurrence[] = [];
  const visit = (node: AstNode) => {
    if (SKIPPED_NODES.has(node.type)) {
      return;
    }
    const style = styleObjectOf(node);
    if (style) {
      fromStyle(style, out);
      return;
    }
    fromNode(node, text, out);
    for (const child of childrenOf(node)) {
      visit(child);
    }
  };
  if (isNode(ast)) {
    visit(ast);
  }
  return out;
};

/**
 * A stylesheet's declarations and `@apply`, outside the `@theme` blocks, and not the custom
 * properties: those define the design system rather than use it.
 */
const fromStylesheet = (text: string): UsageOccurrence[] => {
  const parsed = parseStylesheet("", text);
  const lineAt = lineIndex(text);
  const out: UsageOccurrence[] = [];
  for (const statement of parsed.statements) {
    if (statement.name === "apply" && !statement.prelude.includes("@theme")) {
      fromString(
        statement.params,
        lineAt(statement.paramsStart),
        out,
        statement.paramsStart
      );
    }
  }
  for (const decl of parsed.declarations) {
    if (
      decl.name.startsWith("--") ||
      decl.prelude.includes("@theme") ||
      decl.value.startsWith("@")
    ) {
      continue;
    }
    out.push({
      end: decl.valueEnd,
      line: lineAt(decl.declStart),
      raw: `${decl.name}: ${decl.value}`,
      start: decl.valueStart,
      use: `css:${decl.name}`,
      value: decl.value,
    });
  }
  return out;
};

export const scanFile = (
  file: string,
  text: string
): readonly UsageOccurrence[] =>
  file.endsWith(".css") ? fromStylesheet(text) : fromScript(text);
