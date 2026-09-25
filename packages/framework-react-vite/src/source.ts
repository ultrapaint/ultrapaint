/**
 * TSX source engine. Locates JSX elements by the same line:column the stamping plugin writes,
 * and performs surgical edits with magic-string so untouched code keeps its formatting.
 */
import { posix } from "node:path";
import { parse } from "@babel/parser";
import type { JsonValue, SourceLocation } from "@ultrapaint/contracts/base";
import type {
  Declaration,
  EditOp,
  ElementSource,
  ImportSpec,
  OutlineElement,
} from "@ultrapaint/contracts/edit";
import {
  type EditOutcome,
  type ExtractedElement,
  SourceEditError,
  type SourceEditor,
} from "@ultrapaint/framework-api/node";
import MagicString from "magic-string";
import { twMerge } from "tailwind-merge";

const NEEDS_EXPRESSION_ATTR_RE = /["\n]/;
const NEEDS_EXPRESSION_TEXT_RE = /[{}<>]/;
const ATTR_NAME_END_RE = /[=\s]/;
const WHITESPACE_CHAR_RE = /\s/;
const WHITESPACE_RUN_RE = /\s+/;

/**
 * This module is pure and synchronous. It throws `SourceEditError` for edits that cannot be
 * applied; the server turns it into a wire error at the service boundary.
 */

export interface Node {
  end: number;
  loc: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  start: number;
  type: string;
  [key: string]: unknown;
}

export interface JsxElement extends Node {
  children: Node[];
  closingElement: Node | null;
  openingElement: Node & {
    name: Node;
    attributes: Node[];
    selfClosing: boolean;
  };
  type: "JSXElement";
}

const isNode = (v: unknown): v is Node =>
  typeof v === "object" && v !== null && typeof (v as Node).type === "string";

export const parseTsx = (code: string): Node =>
  parse(code, {
    attachComment: false,
    errorRecovery: true,
    plugins: ["jsx", "typescript", "decorators-legacy"],
    ranges: true,
    sourceType: "module",
  }) as unknown as Node;

/** Direct child nodes in key order, skipping position metadata. */
const childNodes = (node: Node): Node[] => {
  const out: Node[] = [];
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "range") {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      for (const v of value) {
        if (isNode(v)) {
          out.push(v);
        }
      }
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out;
};

/** All JSX elements in document (pre-order) order, with their parent. */
export const collectElements = (
  ast: Node
): { node: JsxElement; parent: Node | null }[] => {
  const out: { node: JsxElement; parent: Node | null }[] = [];
  const visit = (node: Node, parent: Node | null) => {
    if (node.type === "JSXElement") {
      out.push({ node: node as JsxElement, parent });
    }
    for (const child of childNodes(node)) {
      visit(child, node);
    }
  };
  visit(ast, null);
  return out;
};

export const findElementIndex = (
  elements: { node: JsxElement }[],
  loc: SourceLocation
): number =>
  elements.findIndex(
    ({ node }) =>
      node.openingElement.loc.start.line === loc.line &&
      node.openingElement.loc.start.column === loc.col
  );

const subtreeSize = (node: JsxElement): number => collectElements(node).length;

export const jsxName = (name: Node): string => {
  switch (name.type) {
    case "JSXIdentifier":
      return name.name as string;
    case "JSXMemberExpression":
      return `${jsxName(name.object as Node)}.${jsxName(name.property as Node)}`;
    case "JSXNamespacedName":
      return `${(name.namespace as Node).name}:${(name.name as Node).name}`;
    default:
      return "?";
  }
};

const literalValue = (
  expr: Node | null | undefined
): { ok: true; value: JsonValue } | { ok: false } => {
  if (!expr) {
    return { ok: false };
  }
  switch (expr.type) {
    case "StringLiteral":
      return { ok: true, value: expr.value as string };
    case "NumericLiteral":
      return { ok: true, value: expr.value as number };
    case "BooleanLiteral":
      return { ok: true, value: expr.value as boolean };
    case "NullLiteral":
      return { ok: true, value: null };
    case "TemplateLiteral": {
      const quasis = expr.quasis as Node[];
      const exprs = expr.expressions as Node[];
      if (exprs.length === 0 && quasis[0]) {
        return {
          ok: true,
          value: (quasis[0].value as { cooked: string }).cooked,
        };
      }
      return { ok: false };
    }
    case "JSXExpressionContainer":
      return literalValue(expr.expression as Node);
    default:
      return { ok: false };
  }
};

const attrName = (attr: Node): string | null =>
  attr.type === "JSXAttribute" ? jsxName(attr.name as Node) : null;

const findAttr = (el: JsxElement, name: string): Node | undefined =>
  el.openingElement.attributes.find((a) => attrName(a) === name);

export const locationOf = (el: JsxElement, file: string): SourceLocation => ({
  col: el.openingElement.loc.start.column,
  file,
  line: el.openingElement.loc.start.line,
});

/** Text children when the element only contains text (or a single string expression). */
const textOf = (el: JsxElement): string | null => {
  if (el.children.length === 0) {
    return el.openingElement.selfClosing ? null : "";
  }
  let text = "";
  for (const c of el.children) {
    if (c.type === "JSXText") {
      text += c.value as string;
    } else if (c.type === "JSXExpressionContainer") {
      const lit = literalValue(c);
      if (!lit.ok || typeof lit.value !== "string") {
        return null;
      }
      text += lit.value;
    } else {
      return null;
    }
  }
  return text.replaceAll(/\s+/g, " ").trim();
};

export const elementSource = (
  code: string,
  file: string,
  loc: SourceLocation,
  editable: boolean
): ElementSource | null => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const idx = findElementIndex(elements, loc);
  const found = elements[idx];
  if (!found) {
    return null;
  }
  const el = found.node;
  const attributes = el.openingElement.attributes.map((a) => {
    if (a.type !== "JSXAttribute") {
      return { name: "...", raw: code.slice(a.start, a.end), value: null };
    }
    const lit = a.value
      ? literalValue(a.value as Node)
      : { ok: true as const, value: true };
    return {
      name: attrName(a) as string,
      raw: code.slice(a.start, a.end),
      value: lit.ok ? lit.value : null,
    };
  });
  const classAttr = findAttr(el, "className");
  const classLit = classAttr
    ? literalValue(classAttr.value as Node)
    : { ok: false as const };
  return {
    attributes,
    className:
      classLit.ok && typeof classLit.value === "string"
        ? classLit.value
        : classStringOf(classAttr),
    editable,
    location: locationOf(el, file),
    name: jsxName(el.openingElement.name),
    text: textOf(el),
  };
};

/** When className is `cn("...", ...)`, returns the first string argument. */
const classStringOf = (classAttr: Node | undefined): string | null => {
  const target = classStringTarget(classAttr);
  return target ? (target.value as string) : null;
};

const classStringTarget = (classAttr: Node | undefined): Node | null => {
  if (!classAttr?.value) {
    return null;
  }
  const value = classAttr.value as Node;
  if (value.type === "StringLiteral") {
    return value;
  }
  if (value.type !== "JSXExpressionContainer") {
    return null;
  }
  const expr = value.expression as Node;
  if (expr.type === "StringLiteral") {
    return expr;
  }
  if (
    expr.type === "TemplateLiteral" &&
    (expr.expressions as Node[]).length === 0
  ) {
    return expr;
  }
  if (expr.type === "CallExpression") {
    const first = (expr.arguments as Node[]).find(
      (a) => a.type === "StringLiteral"
    );
    return first ?? null;
  }
  return null;
};

const renderAttr = (name: string, value: JsonValue): string => {
  if (value === true) {
    return name;
  }
  if (typeof value === "string") {
    return NEEDS_EXPRESSION_ATTR_RE.test(value)
      ? `${name}={${JSON.stringify(value)}}`
      : `${name}="${value}"`;
  }
  return `${name}={${JSON.stringify(value)}}`;
};

const renderText = (text: string): string =>
  NEEDS_EXPRESSION_TEXT_RE.test(text) ? `{${JSON.stringify(text)}}` : text;

/** Position to insert a new attribute so that attributes stay alphabetical where they already are. */
const attrInsertion = (
  el: JsxElement,
  name: string
): { at: number; before: boolean } => {
  const attrs = el.openingElement.attributes;
  for (const a of attrs) {
    const n = attrName(a);
    if (n && n.localeCompare(name) > 0) {
      return { at: a.start, before: true };
    }
    if (a.type === "JSXSpreadAttribute") {
      return { at: a.start, before: true };
    }
  }
  const last = attrs.at(-1);
  const nameNode = el.openingElement.name;
  const typeArgs = (el.openingElement.typeParameters ??
    el.openingElement.typeArguments) as Node | undefined;
  return {
    at: last ? last.end : (typeArgs?.end ?? nameNode.end),
    before: false,
  };
};

const insertAttr = (ms: MagicString, el: JsxElement, text: string) => {
  const { at, before } = attrInsertion(
    el,
    text.split(ATTR_NAME_END_RE)[0] ?? text
  );
  if (before) {
    ms.appendLeft(at, `${text} `);
  } else {
    ms.appendLeft(at, ` ${text}`);
  }
};

const removeAttr = (ms: MagicString, code: string, attr: Node) => {
  let { start } = attr;
  while (start > 0 && WHITESPACE_CHAR_RE.test(code[start - 1] as string)) {
    start -= 1;
  }
  ms.remove(start, attr.end);
};

export const mergeClasses = (
  existing: string,
  add: readonly string[],
  remove: readonly string[]
): string => {
  const kept = existing
    .split(WHITESPACE_RUN_RE)
    .filter((c) => c && !remove.includes(c));
  return twMerge([...kept, ...add].join(" "));
};

/** Index-based whitespace helpers. */
const lineStart = (code: string, pos: number) => {
  let i = pos;
  while (i > 0 && code[i - 1] !== "\n") {
    i -= 1;
  }
  return i;
};
const indentAt = (code: string, pos: number) => {
  const ls = lineStart(code, pos);
  if (code.slice(ls, pos).trim() !== "") {
    return "";
  }
  // Leading run of spaces/tabs only, even if the prefix holds other whitespace.
  let end = ls;
  while (end < pos && (code[end] === " " || code[end] === "\t")) {
    end += 1;
  }
  return code.slice(ls, end);
};

const removeWithLine = (
  ms: MagicString,
  code: string,
  start: number,
  end: number
) => {
  const ls = lineStart(code, start);
  const prefixBlank = code.slice(ls, start).trim() === "";
  let e = end;
  while (e < code.length && (code[e] === " " || code[e] === "\t")) {
    e += 1;
  }
  const suffixNewline = code[e] === "\n";
  if (prefixBlank && suffixNewline) {
    ms.remove(ls, e + 1);
  } else {
    ms.remove(start, end);
  }
};

const elementChildren = (el: JsxElement): JsxElement[] =>
  el.children.filter((c): c is JsxElement => c.type === "JSXElement");

/** Inserts `text` as the `index`-th element child of `parent`. */
const insertChild = (
  ms: MagicString,
  code: string,
  parent: JsxElement,
  index: number,
  text: string,
  exclude?: JsxElement
) => {
  const children = elementChildren(parent).filter((c) => c !== exclude);
  if (parent.openingElement.selfClosing) {
    const open = parent.openingElement;
    const indent = indentAt(code, parent.start);
    ms.overwrite(
      open.end - 2,
      open.end,
      `>\n${indent}  ${text}\n${indent}</${jsxName(open.name)}>`
    );
    return;
  }
  const target = children[index];
  if (target) {
    ms.appendLeft(
      target.start,
      `${text}\n${indentAt(code, target.start) || "  "}`
    );
    return;
  }
  const last = children.at(-1);
  if (last) {
    ms.appendLeft(last.end, `\n${indentAt(code, last.start) || "  "}${text}`);
    return;
  }
  const indent = indentAt(code, parent.start);
  ms.appendLeft(parent.openingElement.end, `\n${indent}  ${text}\n${indent}`);
};

const require = (
  elements: { node: JsxElement; parent: Node | null }[],
  loc: SourceLocation
) => {
  const idx = findElementIndex(elements, loc);
  const found = elements[idx];
  if (!found) {
    throw new SourceEditError(
      "not_found",
      `no JSX element at ${loc.file}:${loc.line}:${loc.col}; the file may have changed`
    );
  }
  return { idx, ...found };
};

/** Rewrites an existing className attribute: its string when it has one, else a `cn(...)` call. */
const mergeIntoClassAttr = (
  ms: MagicString,
  code: string,
  attr: Node,
  add: readonly string[],
  remove: readonly string[]
) => {
  const target = classStringTarget(attr);
  if (target) {
    // Template literals carry no `value`, so they start from an empty class list.
    const existing = (target.value as string | undefined) ?? "";
    const merged = mergeClasses(existing, add, remove);
    const quote = code[target.start];
    const q = quote === "`" ? '"' : quote;
    ms.overwrite(target.start, target.end, `${q}${merged}${q}`);
    return;
  }
  const value = attr.value as Node;
  const expr =
    value.type === "JSXExpressionContainer"
      ? (value.expression as Node)
      : value;
  if (expr.type !== "CallExpression") {
    throw new SourceEditError(
      "conflict",
      "className is computed from an expression; edit the source directly"
    );
  }
  const merged = mergeClasses("", add, remove);
  const [first] = expr.arguments as Node[];
  if (first) {
    ms.appendLeft(first.start, `"${merged}", `);
  } else {
    ms.appendLeft(expr.end - 1, `"${merged}"`);
  }
};

export const applySetClasses = (
  code: string,
  loc: SourceLocation,
  add: readonly string[],
  remove: readonly string[]
): EditOutcome => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const { idx, node } = require(elements, loc);
  const ms = new MagicString(code);
  const attr = findAttr(node, "className");
  const warnings: string[] = [];
  if (attr) {
    mergeIntoClassAttr(ms, code, attr, add, remove);
  } else {
    const merged = mergeClasses("", add, remove);
    if (merged) {
      insertAttr(ms, node, `className="${merged}"`);
    }
  }
  return { code: ms.toString(), trackIndex: idx, warnings };
};

export const applySetAttribute = (
  code: string,
  loc: SourceLocation,
  name: string,
  value: JsonValue
): EditOutcome => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const { idx, node } = require(elements, loc);
  const ms = new MagicString(code);
  const attr = findAttr(node, name);
  if (value === null) {
    if (attr) {
      removeAttr(ms, code, attr);
    }
  } else if (attr) {
    ms.overwrite(attr.start, attr.end, renderAttr(name, value));
  } else {
    insertAttr(ms, node, renderAttr(name, value));
  }
  return { code: ms.toString(), trackIndex: idx, warnings: [] };
};

export const applySetText = (
  code: string,
  loc: SourceLocation,
  text: string
): EditOutcome => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const { idx, node } = require(elements, loc);
  const ms = new MagicString(code);
  const open = node.openingElement;
  if (open.selfClosing) {
    ms.overwrite(
      open.end - 2,
      open.end,
      `>${renderText(text)}</${jsxName(open.name)}>`
    );
  } else {
    const close = node.closingElement as Node;
    if (
      node.children.some(
        (c) => c.type === "JSXElement" || c.type === "JSXFragment"
      )
    ) {
      throw new SourceEditError(
        "conflict",
        "element has child elements; only text-only elements can be edited inline"
      );
    }
    if (open.end === close.start) {
      ms.appendLeft(open.end, renderText(text));
    } else {
      ms.overwrite(open.end, close.start, renderText(text));
    }
  }
  return { code: ms.toString(), trackIndex: idx, warnings: [] };
};

export const applyDelete = (code: string, loc: SourceLocation): EditOutcome => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const { node, parent } = require(elements, loc);
  if (
    !parent ||
    (parent.type !== "JSXElement" && parent.type !== "JSXFragment")
  ) {
    throw new SourceEditError(
      "conflict",
      "only elements nested in other JSX can be deleted"
    );
  }
  const ms = new MagicString(code);
  removeWithLine(ms, code, node.start, node.end);
  return {
    code: removeUnusedImports(ms.toString()),
    trackIndex: null,
    warnings: [],
  };
};

export const applyDuplicate = (
  code: string,
  loc: SourceLocation
): EditOutcome => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const { idx, node, parent } = require(elements, loc);
  if (
    !parent ||
    (parent.type !== "JSXElement" && parent.type !== "JSXFragment")
  ) {
    throw new SourceEditError(
      "conflict",
      "only elements nested in other JSX can be duplicated"
    );
  }
  const ms = new MagicString(code);
  const text = code.slice(node.start, node.end);
  const indent = indentAt(code, node.start);
  ms.appendLeft(node.end, `\n${indent}${text}`);
  return {
    code: ms.toString(),
    trackIndex: idx + subtreeSize(node),
    warnings: [],
  };
};

export const applyMove = (
  code: string,
  loc: SourceLocation,
  into: SourceLocation,
  index: number
): EditOutcome => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const source = require(elements, loc);
  const target = require(elements, into);
  if (
    target.node.start >= source.node.start &&
    target.node.end <= source.node.end
  ) {
    throw new SourceEditError("conflict", "cannot move an element into itself");
  }
  if (
    !source.parent ||
    (source.parent.type !== "JSXElement" &&
      source.parent.type !== "JSXFragment")
  ) {
    throw new SourceEditError(
      "conflict",
      "only elements nested in other JSX can be moved"
    );
  }
  const ms = new MagicString(code);
  const text = code.slice(source.node.start, source.node.end);
  removeWithLine(ms, code, source.node.start, source.node.end);
  insertChild(ms, code, target.node, index, text, source.node);
  const newCode = ms.toString();
  // Locate the moved element: it is the index-th element child of the target in the new code.
  const newElements = collectElements(parseTsx(newCode));
  const shift =
    source.node.start < target.node.start ? subtreeSize(source.node) : 0;
  const parentNode = newElements[target.idx - shift]?.node;
  const child = parentNode
    ? elementChildren(parentNode)[
        Math.min(index, elementChildren(parentNode).length - 1)
      ]
    : undefined;
  const trackIndex = child
    ? newElements.findIndex((e) => e.node === child)
    : null;
  return { code: newCode, trackIndex, warnings: [] };
};

export const applyInsert = (
  code: string,
  into: SourceLocation,
  index: number,
  jsx: string,
  imports: readonly ImportSpec[],
  declarations: readonly Declaration[] = []
): EditOutcome => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const target = require(elements, into);
  const ms = new MagicString(code);
  insertChild(ms, code, target.node, index, jsx.trim());
  addImports(ms, ast, imports);
  const added = addDeclarations(ms, ast, declarations);
  const newCode = ms.toString();
  // Everything added outside the parent lands above it: the parent moves down by the elements
  // the new declarations hold, and the inserted child is the index-th of its children.
  const shift = added ? collectElements(parseTsx(added)).length : 0;
  const newElements = collectElements(parseTsx(newCode));
  const parentNode = newElements[target.idx + shift]?.node;
  const kids = parentNode ? elementChildren(parentNode) : [];
  const child = kids[Math.min(index, kids.length - 1)];
  const trackIndex = child
    ? newElements.findIndex((e) => e.node === child)
    : null;
  return { code: newCode, trackIndex, warnings: [] };
};

/** Appends a named specifier to an existing import declaration. */
const appendNamedImport = (ms: MagicString, decl: Node, name: string) => {
  const named = (decl.specifiers as Node[]).filter(
    (s) => s.type === "ImportSpecifier"
  );
  const last = named.at(-1);
  if (last) {
    ms.appendLeft(last.end, `, ${name}`);
    return;
  }
  const [def] = decl.specifiers as Node[];
  if (def) {
    ms.appendLeft(def.end, `, { ${name} }`);
  }
};

/** The name an import binds in the file that holds it. */
const localName = (spec: ImportSpec) =>
  spec.isDefault || spec.isNamespace ? spec.name : (spec.alias ?? spec.name);

const importClause = (spec: ImportSpec) => {
  if (spec.isNamespace) {
    return `* as ${spec.name}`;
  }
  if (spec.isDefault) {
    return spec.name;
  }
  return `{ ${namedSpecifier(spec)} }`;
};

const namedSpecifier = (spec: ImportSpec) =>
  spec.alias && spec.alias !== spec.name
    ? `${spec.name} as ${spec.alias}`
    : spec.name;

/** Adds imports, reusing an existing declaration for the same module when present. */
export const addImports = (
  ms: MagicString,
  ast: Node,
  imports: readonly ImportSpec[]
) => {
  const body = (ast.program as Node).body as Node[];
  const decls = body.filter((n) => n.type === "ImportDeclaration");
  const importedNames = new Set<string>();
  for (const d of decls) {
    for (const s of d.specifiers as Node[]) {
      importedNames.add((s.local as Node).name as string);
    }
  }
  const lastImport = decls.at(-1);
  const insertAt = lastImport ? lastImport.end : 0;
  const additions: string[] = [];
  for (const spec of imports) {
    const local = localName(spec);
    if (importedNames.has(local)) {
      continue;
    }
    const existing = decls.find(
      (d) =>
        (d.source as Node).value === spec.from &&
        d.importKind !== "type" &&
        !(d.specifiers as Node[]).some(
          (s) => s.type === "ImportNamespaceSpecifier"
        )
    );
    if (existing && !spec.isDefault && !spec.isNamespace) {
      appendNamedImport(ms, existing, namedSpecifier(spec));
    } else {
      additions.push(`import ${importClause(spec)} from "${spec.from}";`);
    }
    importedNames.add(local);
  }
  if (additions.length) {
    ms.appendLeft(
      insertAt,
      `${insertAt === 0 ? "" : "\n"}${additions.join("\n")}${insertAt === 0 ? "\n" : ""}`
    );
  }
};

/** Names a statement binds at the top level of its module. */
const boundNames = (statement: Node): string[] => {
  const inner =
    statement.type === "ExportNamedDeclaration" ||
    statement.type === "ExportDefaultDeclaration"
      ? (statement.declaration as Node | null)
      : statement;
  if (!inner) {
    return [];
  }
  switch (inner.type) {
    case "ImportDeclaration":
      return (inner.specifiers as Node[]).map(
        (s) => (s.local as Node).name as string
      );
    case "VariableDeclaration":
      return (inner.declarations as Node[]).flatMap((d) =>
        patternNames(d.id as Node)
      );
    case "FunctionDeclaration":
    case "ClassDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSInterfaceDeclaration":
    case "TSEnumDeclaration": {
      const id = inner.id as Node | null;
      return id ? [id.name as string] : [];
    }
    default:
      return [];
  }
};

/** Identifiers a binding pattern declares: `a`, `{ a, b: c }`, `[a, ...rest]`. */
const patternNames = (pattern: Node | null | undefined): string[] => {
  if (!pattern) {
    return [];
  }
  switch (pattern.type) {
    case "Identifier":
      return [pattern.name as string];
    case "ObjectPattern":
      return (pattern.properties as Node[]).flatMap((p) =>
        p.type === "RestElement"
          ? patternNames(p.argument as Node)
          : patternNames(p.value as Node)
      );
    case "ArrayPattern":
      return (pattern.elements as (Node | null)[]).flatMap((e) =>
        patternNames(e)
      );
    case "RestElement":
      return patternNames(pattern.argument as Node);
    case "AssignmentPattern":
      return patternNames(pattern.left as Node);
    default:
      return [];
  }
};

const topLevelNames = (ast: Node): Set<string> =>
  new Set(((ast.program as Node).body as Node[]).flatMap(boundNames));

/**
 * Adds the declarations whose name the module does not bind yet, below its imports. Returns
 * the text added, which is what shifts the elements after it.
 */
const addDeclarations = (
  ms: MagicString,
  ast: Node,
  declarations: readonly Declaration[]
): string => {
  const taken = topLevelNames(ast);
  const missing = declarations.filter((d) => !taken.has(d.name));
  if (missing.length === 0) {
    return "";
  }
  const body = (ast.program as Node).body as Node[];
  const lastImport = body.filter((n) => n.type === "ImportDeclaration").at(-1);
  const text = missing.map((d) => d.code).join("\n\n");
  if (lastImport) {
    ms.appendLeft(lastImport.end, `\n\n${text}`);
  } else {
    ms.appendLeft(0, `${text}\n\n`);
  }
  return text;
};

// ---- Extraction ----

const FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "ObjectMethod",
  "ClassMethod",
]);

/**
 * Names a piece of code refers to, and the names it binds itself (parameters, local variables)
 * which are therefore not references to anything outside it. Over-inclusive on purpose: a name
 * too many costs an import the formatter removes, a name too few a copy that does not render.
 */
const KEY_PARENTS = new Set([
  "ClassMethod",
  "ClassProperty",
  "ObjectMethod",
  "ObjectProperty",
]);

/** Whether an identifier names a property rather than a binding: `a.b`, `{ b: 1 }`. */
const isPropertyName = (parent: Node | null, key: string | null) =>
  !!parent &&
  !parent.computed &&
  (((parent.type === "MemberExpression" ||
    parent.type === "OptionalMemberExpression") &&
    key === "property") ||
    (KEY_PARENTS.has(parent.type) && key === "key" && !parent.shorthand));

/** The binding a JSX tag refers to: `Card` and `ui` of `<ui.Card>`, nothing for `<div>`. */
const tagReference = (name: Node): string | null => {
  let root = name;
  while (root.type === "JSXMemberExpression") {
    root = root.object as Node;
  }
  const n = root.name as string | undefined;
  if (!n) {
    return null;
  }
  return name.type === "JSXMemberExpression" || n[0] !== n[0]?.toLowerCase()
    ? n
    : null;
};

/** Names a node declares for the code inside it: parameters, variables, a function's own name. */
const declaredBy = (node: Node): string[] => {
  if (node.type === "VariableDeclarator") {
    return patternNames(node.id as Node);
  }
  if (node.type === "CatchClause") {
    return patternNames(node.param as Node);
  }
  if (!FUNCTION_TYPES.has(node.type)) {
    return [];
  }
  const id = node.id as Node | null | undefined;
  return [
    ...(node.params as Node[]).flatMap((p) => patternNames(p)),
    ...(id?.type === "Identifier" ? [id.name as string] : []),
  ];
};

/** The children a walk looks into: an attribute's name and a tag's name are not references. */
const walkedChildren = (node: Node): [Node, string][] => {
  if (node.type === "JSXAttribute") {
    return node.value ? [[node.value as Node, "value"]] : [];
  }
  if (node.type === "JSXOpeningElement" || node.type === "JSXClosingElement") {
    return ((node.attributes as Node[] | undefined) ?? []).map((a) => [
      a,
      "attributes",
    ]);
  }
  const out: [Node, string][] = [];
  for (const k of Object.keys(node)) {
    if (k === "loc" || k === "range") {
      continue;
    }
    const value = node[k];
    for (const v of Array.isArray(value) ? value : [value]) {
      if (isNode(v)) {
        out.push([v, k]);
      }
    }
  }
  return out;
};

/**
 * Names a piece of code refers to, and the names it binds itself (parameters, local variables)
 * which are therefore not references to anything outside it. Over-inclusive on purpose: a name
 * too many costs an import the formatter removes, a name too few a copy that does not render.
 */
const namesIn = (root: Node): { bound: Set<string>; used: Set<string> } => {
  const used = new Set<string>();
  const bound = new Set<string>();
  const visit = (node: Node, parent: Node | null, key: string | null) => {
    if (node.type === "Identifier" && !isPropertyName(parent, key)) {
      used.add(node.name as string);
    }
    if (
      node.type === "JSXOpeningElement" ||
      node.type === "JSXClosingElement"
    ) {
      const tag = tagReference(node.name as Node);
      if (tag) {
        used.add(tag);
      }
    }
    for (const name of declaredBy(node)) {
      bound.add(name);
    }
    for (const [child, k] of walkedChildren(node)) {
      visit(child, node, k);
    }
  };
  visit(root, null, null);
  return { bound, used };
};

/** What an import specifier binds, as the spec that would import it again. */
const specOf = (s: Node, from: string): ImportSpec => {
  const local = (s.local as Node).name as string;
  if (s.type === "ImportDefaultSpecifier") {
    return { from, isDefault: true, name: local };
  }
  if (s.type === "ImportNamespaceSpecifier") {
    return { from, isNamespace: true, name: local };
  }
  const imported = s.imported as Node;
  const name = (imported.name ?? imported.value) as string;
  return name === local ? { from, name } : { alias: local, from, name };
};

/** Every import binding of a module, keyed by the name it binds. Types stay behind. */
const importBindings = (ast: Node): Map<string, ImportSpec> => {
  const out = new Map<string, ImportSpec>();
  for (const d of (ast.program as Node).body as Node[]) {
    if (d.type !== "ImportDeclaration" || d.importKind === "type") {
      continue;
    }
    const from = (d.source as Node).value as string;
    for (const s of d.specifiers as Node[]) {
      if (s.importKind !== "type") {
        out.set((s.local as Node).name as string, specOf(s, from));
      }
    }
  }
  return out;
};

/** Top-level statements other than imports and the default export, by the names they bind. */
const declarationBindings = (
  ast: Node,
  code: string
): Map<string, { code: string; node: Node }> => {
  const out = new Map<string, { code: string; node: Node }>();
  for (const statement of (ast.program as Node).body as Node[]) {
    if (
      statement.type === "ImportDeclaration" ||
      statement.type === "ExportDefaultDeclaration"
    ) {
      continue;
    }
    // A helper exported from a page is still a helper where it lands; the export stays behind.
    const node =
      statement.type === "ExportNamedDeclaration"
        ? (statement.declaration as Node | null)
        : statement;
    if (!node) {
      continue;
    }
    for (const name of boundNames(node)) {
      out.set(name, { code: code.slice(node.start, node.end), node });
    }
  }
  return out;
};

const RELATIVE_RE = /^\.\.?\//;
const LEADING_DOT_RE = /^\./;

/** A relative specifier written in `from`, rewritten to mean the same file from `to`. */
const rebase = (specifier: string, from: string, to: string): string => {
  if (!RELATIVE_RE.test(specifier)) {
    return specifier;
  }
  const target = posix.join(posix.dirname(from), specifier);
  const rel = posix.relative(posix.dirname(to), target);
  return LEADING_DOT_RE.test(rel) ? rel : `./${rel}`;
};

/** Removes the indentation of the line the element starts on from every line but the first. */
const dedent = (code: string, start: number, text: string): string => {
  const indent = indentAt(code, start);
  if (!indent) {
    return text;
  }
  return text
    .split("\n")
    .map((line, i) =>
      i > 0 && line.startsWith(indent) ? line.slice(indent.length) : line
    )
    .join("\n");
};

export const extractElement = (
  code: string,
  loc: SourceLocation,
  destination: string
): ExtractedElement => {
  const ast = parseTsx(code);
  const { node } = require(collectElements(ast), loc);
  const imports = importBindings(ast);
  const declarations = declarationBindings(ast, code);
  const neededImports = new Map<string, ImportSpec>();
  const neededDeclarations = new Set<{ code: string; node: Node }>();
  const unresolved = new Set<string>();
  const seen = new Set<string>();
  const queue: Node[] = [node];
  while (queue.length > 0) {
    const current = queue.shift() as Node;
    const { bound, used } = namesIn(current);
    const fresh = [...used].filter((n) => !(bound.has(n) || seen.has(n)));
    for (const name of fresh) {
      seen.add(name);
      const spec = imports.get(name);
      const declaration = declarations.get(name);
      if (spec) {
        neededImports.set(name, {
          ...spec,
          from: rebase(spec.from, loc.file, destination),
        });
      } else if (!declaration) {
        // A global of the platform is there wherever the element lands.
        if (!(name in globalThis)) {
          unresolved.add(name);
        }
      } else if (!neededDeclarations.has(declaration)) {
        neededDeclarations.add(declaration);
        queue.push(declaration.node);
      }
    }
  }
  const ordered = [...neededDeclarations].sort(
    (a, b) => a.node.start - b.node.start
  );
  return {
    declarations: ordered.map((d) => ({
      code: d.code,
      name: boundNames(d.node)[0] ?? "",
    })),
    imports: [...neededImports.values()],
    jsx: dedent(code, node.start, code.slice(node.start, node.end)),
    name: jsxName(node.openingElement.name),
    unresolved: [...unresolved].sort(),
  };
};

/** Removes import specifiers whose local binding is no longer referenced. Bare imports stay. */
export const removeUnusedImports = (code: string): string => {
  const ast = parseTsx(code);
  const body = (ast.program as Node).body as Node[];
  const decls = body.filter((n) => n.type === "ImportDeclaration");
  const used = new Map<string, number>();
  const count = (node: Node, inImport: boolean) => {
    const within = inImport || node.type === "ImportDeclaration";
    if (
      !within &&
      (node.type === "Identifier" || node.type === "JSXIdentifier")
    ) {
      const n = node.name as string;
      used.set(n, (used.get(n) ?? 0) + 1);
    }
    for (const child of childNodes(node)) {
      count(child, within);
    }
  };
  count(ast, false);
  const ms = new MagicString(code);
  for (const d of decls) {
    const specs = d.specifiers as Node[];
    if (specs.length === 0) {
      continue;
    }
    const unused = specs.filter(
      (s) => !used.has((s.local as Node).name as string)
    );
    if (unused.length === 0) {
      continue;
    }
    if (unused.length === specs.length) {
      removeWithLine(ms, code, d.start, d.end);
      continue;
    }
    for (const s of unused) {
      const i = specs.indexOf(s);
      const next = specs[i + 1];
      const prev = specs[i - 1];
      if (next) {
        ms.remove(s.start, next.start);
      } else if (prev) {
        ms.remove(prev.end, s.end);
      } else {
        ms.remove(s.start, s.end);
      }
    }
  }
  return ms.toString();
};

const applyOp = (op: EditOp, code: string): EditOutcome => {
  switch (op.kind) {
    case "setClasses":
      return applySetClasses(code, op.target, op.add, op.remove);
    case "setAttribute":
      return applySetAttribute(code, op.target, op.name, op.value);
    case "setText":
      return applySetText(code, op.target, op.text);
    case "delete":
      return applyDelete(code, op.target);
    case "duplicate":
      return applyDuplicate(code, op.target);
    case "move":
      return applyMove(code, op.target, op.into, op.index);
    default:
      return applyInsert(
        code,
        op.into,
        op.index,
        op.jsx,
        op.imports,
        op.declarations
      );
  }
};

/** Every JSX element with the element it is written inside of, and its declaration. */
export const outlineOf = (code: string): OutlineElement[] => {
  const out: OutlineElement[] = [];
  const indexOf = new Map<Node, number>();
  const visit = (
    node: Node,
    parent: Node | null,
    element: Node | null,
    scope: string
  ) => {
    let inside = element;
    if (node.type === "JSXElement") {
      const open = (node as JsxElement).openingElement.loc.start;
      indexOf.set(node, out.length);
      out.push({
        col: open.column,
        direct: !!element && parent === element,
        line: open.line,
        parent: element ? (indexOf.get(element) ?? null) : null,
        scope,
      });
      inside = node;
    }
    for (const child of childNodes(node)) {
      visit(child, node, inside, scope);
    }
  };
  const program = parseTsx(code).program as Node;
  for (const statement of program.body as Node[]) {
    const scope =
      statement.type === "ExportDefaultDeclaration"
        ? "default"
        : (boundNames(statement)[0] ?? "");
    visit(statement, null, null, scope);
  }
  return out;
};

/** The JSX source editor, as the server uses it. */
export const source: SourceEditor = {
  apply: applyOp,
  elementSource,
  extract: extractElement,
  locate: (code, file, trackIndex) => {
    const element = collectElements(parseTsx(code))[trackIndex]?.node;
    return element ? locationOf(element, file) : null;
  },
  outline: outlineOf,
};
