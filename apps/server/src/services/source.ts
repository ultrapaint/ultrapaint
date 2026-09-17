/**
 * TSX source engine. Locates JSX elements by the same line:column the stamping plugin writes,
 * and performs surgical edits with magic-string so untouched code keeps its formatting.
 */
import { parse } from "@babel/parser";
import type { ElementSource, ImportSpec, JsonValue, SourceLocation } from "@ultrapaint/contracts";
import MagicString from "magic-string";
import { twMerge } from "tailwind-merge";
import { AppError } from "../router.ts";

export interface Node {
  type: string;
  start: number;
  end: number;
  loc: { start: { line: number; column: number }; end: { line: number; column: number } };
  [key: string]: unknown;
}

export interface JsxElement extends Node {
  type: "JSXElement";
  openingElement: Node & { name: Node; attributes: Node[]; selfClosing: boolean };
  closingElement: Node | null;
  children: Node[];
}

const isNode = (v: unknown): v is Node =>
  typeof v === "object" && v !== null && typeof (v as Node).type === "string";

export const parseTsx = (code: string): Node =>
  parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript", "decorators-legacy"],
    ranges: true,
    errorRecovery: true,
    attachComment: false,
  }) as unknown as Node;

/** All JSX elements in document (pre-order) order, with their parent. */
export const collectElements = (ast: Node): { node: JsxElement; parent: Node | null }[] => {
  const out: { node: JsxElement; parent: Node | null }[] = [];
  const visit = (node: Node, parent: Node | null) => {
    if (node.type === "JSXElement") out.push({ node: node as JsxElement, parent });
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "range") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const v of value) if (isNode(v)) visit(v, node);
      } else if (isNode(value)) visit(value, node);
    }
  };
  visit(ast, null);
  return out;
};

export const findElementIndex = (elements: { node: JsxElement }[], loc: SourceLocation): number =>
  elements.findIndex(
    ({ node }) =>
      node.openingElement.loc.start.line === loc.line &&
      node.openingElement.loc.start.column === loc.col,
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
  expr: Node | null | undefined,
): { ok: true; value: JsonValue } | { ok: false } => {
  if (!expr) return { ok: false };
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
      if (exprs.length === 0 && quasis[0])
        return { ok: true, value: (quasis[0].value as { cooked: string }).cooked };
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
  file,
  line: el.openingElement.loc.start.line,
  col: el.openingElement.loc.start.column,
});

/** Text children when the element only contains text (or a single string expression). */
const textOf = (el: JsxElement): string | null => {
  if (el.children.length === 0) return el.openingElement.selfClosing ? null : "";
  let text = "";
  for (const c of el.children) {
    if (c.type === "JSXText") text += c.value as string;
    else if (c.type === "JSXExpressionContainer") {
      const lit = literalValue(c);
      if (!lit.ok || typeof lit.value !== "string") return null;
      text += lit.value;
    } else return null;
  }
  return text.replaceAll(/\s+/g, " ").trim();
};

export const elementSource = (
  code: string,
  file: string,
  loc: SourceLocation,
  editable: boolean,
): ElementSource | null => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const idx = findElementIndex(elements, loc);
  const found = elements[idx];
  if (!found) return null;
  const el = found.node;
  const attributes = el.openingElement.attributes.map((a) => {
    if (a.type !== "JSXAttribute")
      return { name: "...", value: null, raw: code.slice(a.start, a.end) };
    const lit = a.value ? literalValue(a.value as Node) : { ok: true as const, value: true };
    return {
      name: attrName(a) as string,
      value: lit.ok ? lit.value : null,
      raw: code.slice(a.start, a.end),
    };
  });
  const classAttr = findAttr(el, "className");
  const classLit = classAttr ? literalValue(classAttr.value as Node) : { ok: false as const };
  return {
    location: locationOf(el, file),
    name: jsxName(el.openingElement.name),
    className:
      classLit.ok && typeof classLit.value === "string" ? classLit.value : classStringOf(classAttr),
    attributes,
    text: textOf(el),
    editable,
  };
};

/** When className is `cn("...", ...)`, returns the first string argument. */
const classStringOf = (classAttr: Node | undefined): string | null => {
  const target = classStringTarget(classAttr);
  return target ? (target.value as string) : null;
};

const classStringTarget = (classAttr: Node | undefined): Node | null => {
  if (!classAttr?.value) return null;
  const value = classAttr.value as Node;
  if (value.type === "StringLiteral") return value;
  if (value.type !== "JSXExpressionContainer") return null;
  const expr = value.expression as Node;
  if (expr.type === "StringLiteral") return expr;
  if (expr.type === "TemplateLiteral" && (expr.expressions as Node[]).length === 0) return expr;
  if (expr.type === "CallExpression") {
    const first = (expr.arguments as Node[]).find((a) => a.type === "StringLiteral");
    return first ?? null;
  }
  return null;
};

const renderAttr = (name: string, value: JsonValue): string => {
  if (value === true) return name;
  if (typeof value === "string") {
    return value.includes('"') || value.includes("\n")
      ? `${name}={${JSON.stringify(value)}}`
      : `${name}="${value}"`;
  }
  return `${name}={${JSON.stringify(value)}}`;
};

const renderText = (text: string): string =>
  /[{}<>]/.test(text) ? `{${JSON.stringify(text)}}` : text;

/** Position to insert a new attribute so that attributes stay alphabetical where they already are. */
const attrInsertion = (el: JsxElement, name: string): { at: number; before: boolean } => {
  const attrs = el.openingElement.attributes;
  for (const a of attrs) {
    const n = attrName(a);
    if (n && n.localeCompare(name) > 0) return { at: a.start, before: true };
    if (a.type === "JSXSpreadAttribute") return { at: a.start, before: true };
  }
  const last = attrs[attrs.length - 1];
  const nameNode = el.openingElement.name;
  const typeArgs = (el.openingElement.typeParameters ?? el.openingElement.typeArguments) as
    | Node
    | undefined;
  return { at: last ? last.end : (typeArgs?.end ?? nameNode.end), before: false };
};

const insertAttr = (ms: MagicString, el: JsxElement, text: string) => {
  const { at, before } = attrInsertion(el, text.split(/[=\s]/)[0] ?? text);
  if (before) ms.appendLeft(at, `${text} `);
  else ms.appendLeft(at, ` ${text}`);
};

const removeAttr = (ms: MagicString, code: string, attr: Node) => {
  let start = attr.start;
  while (start > 0 && /\s/.test(code[start - 1] as string)) start -= 1;
  ms.remove(start, attr.end);
};

export const mergeClasses = (
  existing: string,
  add: readonly string[],
  remove: readonly string[],
): string => {
  const kept = existing.split(/\s+/).filter((c) => c && !remove.includes(c));
  return twMerge([...kept, ...add].join(" "));
};

/** Index-based whitespace helpers. */
const lineStart = (code: string, pos: number) => {
  let i = pos;
  while (i > 0 && code[i - 1] !== "\n") i -= 1;
  return i;
};
const indentAt = (code: string, pos: number) => {
  const ls = lineStart(code, pos);
  const m = /^[ \t]*/.exec(code.slice(ls, pos));
  return code.slice(ls, pos).trim() === "" ? (m?.[0] ?? "") : "";
};

const removeWithLine = (ms: MagicString, code: string, start: number, end: number) => {
  const ls = lineStart(code, start);
  const prefixBlank = code.slice(ls, start).trim() === "";
  let e = end;
  while (e < code.length && (code[e] === " " || code[e] === "\t")) e += 1;
  const suffixNewline = code[e] === "\n";
  if (prefixBlank && suffixNewline) ms.remove(ls, e + 1);
  else ms.remove(start, end);
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
  exclude?: JsxElement,
) => {
  const children = elementChildren(parent).filter((c) => c !== exclude);
  if (parent.openingElement.selfClosing) {
    const open = parent.openingElement;
    const indent = indentAt(code, parent.start);
    ms.overwrite(
      open.end - 2,
      open.end,
      `>\n${indent}  ${text}\n${indent}</${jsxName(open.name)}>`,
    );
    return;
  }
  const target = children[index];
  if (target) {
    ms.appendLeft(target.start, `${text}\n${indentAt(code, target.start) || "  "}`);
    return;
  }
  const last = children[children.length - 1];
  if (last) {
    ms.appendLeft(last.end, `\n${indentAt(code, last.start) || "  "}${text}`);
    return;
  }
  const indent = indentAt(code, parent.start);
  ms.appendLeft(parent.openingElement.end, `\n${indent}  ${text}\n${indent}`);
};

export interface EditOutcome {
  code: string;
  /** Pre-order index of the element to track after formatting, or null. */
  trackIndex: number | null;
  warnings: string[];
}

const require = (elements: { node: JsxElement; parent: Node | null }[], loc: SourceLocation) => {
  const idx = findElementIndex(elements, loc);
  const found = elements[idx];
  if (!found)
    throw new AppError(
      "not_found",
      `no JSX element at ${loc.file}:${loc.line}:${loc.col}; the file may have changed`,
    );
  return { idx, ...found };
};

export const applySetClasses = (
  code: string,
  loc: SourceLocation,
  add: readonly string[],
  remove: readonly string[],
): EditOutcome => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const { idx, node } = require(elements, loc);
  const ms = new MagicString(code);
  const attr = findAttr(node, "className");
  const warnings: string[] = [];
  if (!attr) {
    const merged = mergeClasses("", add, remove);
    if (merged) insertAttr(ms, node, `className="${merged}"`);
  } else {
    const target = classStringTarget(attr);
    if (!target) {
      const value = attr.value as Node;
      const expr = value.type === "JSXExpressionContainer" ? (value.expression as Node) : value;
      if (expr.type === "CallExpression") {
        const merged = mergeClasses("", add, remove);
        const args = expr.arguments as Node[];
        const first = args[0];
        if (first) ms.appendLeft(first.start, `"${merged}", `);
        else ms.appendLeft(expr.end - 1, `"${merged}"`);
      } else {
        throw new AppError(
          "conflict",
          "className is computed from an expression; edit the source directly",
        );
      }
    } else {
      const existing = (target.value as string) ?? "";
      const merged = mergeClasses(existing, add, remove);
      const quote = code[target.start];
      const q = quote === "`" ? '"' : quote;
      ms.overwrite(target.start, target.end, `${q}${merged}${q}`);
    }
  }
  return { code: ms.toString(), trackIndex: idx, warnings };
};

export const applySetAttribute = (
  code: string,
  loc: SourceLocation,
  name: string,
  value: JsonValue,
): EditOutcome => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const { idx, node } = require(elements, loc);
  const ms = new MagicString(code);
  const attr = findAttr(node, name);
  if (value === null) {
    if (attr) removeAttr(ms, code, attr);
  } else if (attr) {
    ms.overwrite(attr.start, attr.end, renderAttr(name, value));
  } else {
    insertAttr(ms, node, renderAttr(name, value));
  }
  return { code: ms.toString(), trackIndex: idx, warnings: [] };
};

export const applySetText = (code: string, loc: SourceLocation, text: string): EditOutcome => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const { idx, node } = require(elements, loc);
  const ms = new MagicString(code);
  const open = node.openingElement;
  if (open.selfClosing) {
    ms.overwrite(open.end - 2, open.end, `>${renderText(text)}</${jsxName(open.name)}>`);
  } else {
    const close = node.closingElement as Node;
    if (node.children.some((c) => c.type === "JSXElement" || c.type === "JSXFragment")) {
      throw new AppError(
        "conflict",
        "element has child elements; only text-only elements can be edited inline",
      );
    }
    if (open.end === close.start) ms.appendLeft(open.end, renderText(text));
    else ms.overwrite(open.end, close.start, renderText(text));
  }
  return { code: ms.toString(), trackIndex: idx, warnings: [] };
};

export const applyDelete = (code: string, loc: SourceLocation): EditOutcome => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const { node, parent } = require(elements, loc);
  if (!parent || (parent.type !== "JSXElement" && parent.type !== "JSXFragment")) {
    throw new AppError("conflict", "only elements nested in other JSX can be deleted");
  }
  const ms = new MagicString(code);
  removeWithLine(ms, code, node.start, node.end);
  return { code: removeUnusedImports(ms.toString()), trackIndex: null, warnings: [] };
};

export const applyDuplicate = (code: string, loc: SourceLocation): EditOutcome => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const { idx, node, parent } = require(elements, loc);
  if (!parent || (parent.type !== "JSXElement" && parent.type !== "JSXFragment")) {
    throw new AppError("conflict", "only elements nested in other JSX can be duplicated");
  }
  const ms = new MagicString(code);
  const text = code.slice(node.start, node.end);
  const indent = indentAt(code, node.start);
  ms.appendLeft(node.end, `\n${indent}${text}`);
  return { code: ms.toString(), trackIndex: idx + subtreeSize(node), warnings: [] };
};

export const applyMove = (
  code: string,
  loc: SourceLocation,
  into: SourceLocation,
  index: number,
): EditOutcome => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const source = require(elements, loc);
  const target = require(elements, into);
  if (target.node.start >= source.node.start && target.node.end <= source.node.end) {
    throw new AppError("conflict", "cannot move an element into itself");
  }
  if (
    !source.parent ||
    (source.parent.type !== "JSXElement" && source.parent.type !== "JSXFragment")
  ) {
    throw new AppError("conflict", "only elements nested in other JSX can be moved");
  }
  const ms = new MagicString(code);
  const text = code.slice(source.node.start, source.node.end);
  removeWithLine(ms, code, source.node.start, source.node.end);
  insertChild(ms, code, target.node, index, text, source.node);
  const newCode = ms.toString();
  // Locate the moved element: it is the index-th element child of the target in the new code.
  const newElements = collectElements(parseTsx(newCode));
  const shift = source.node.start < target.node.start ? subtreeSize(source.node) : 0;
  const parentNode = newElements[target.idx - shift]?.node;
  const child = parentNode
    ? elementChildren(parentNode)[Math.min(index, elementChildren(parentNode).length - 1)]
    : undefined;
  const trackIndex = child ? newElements.findIndex((e) => e.node === child) : null;
  return { code: newCode, trackIndex, warnings: [] };
};

export const applyInsert = (
  code: string,
  into: SourceLocation,
  index: number,
  jsx: string,
  imports: readonly ImportSpec[],
): EditOutcome => {
  const ast = parseTsx(code);
  const elements = collectElements(ast);
  const target = require(elements, into);
  const ms = new MagicString(code);
  insertChild(ms, code, target.node, index, jsx.trim());
  addImports(ms, ast, imports);
  const newCode = ms.toString();
  const newElements = collectElements(parseTsx(newCode));
  const parentNode = newElements.find(
    (e) =>
      e.node.openingElement.loc.start.line >= target.node.openingElement.loc.start.line &&
      jsxName(e.node.openingElement.name) === jsxName(target.node.openingElement.name) &&
      e.node.openingElement.attributes.length === target.node.openingElement.attributes.length,
  )?.node;
  const kids = parentNode ? elementChildren(parentNode) : [];
  const child = kids[Math.min(index, kids.length - 1)];
  const trackIndex = child ? newElements.findIndex((e) => e.node === child) : null;
  return { code: newCode, trackIndex, warnings: [] };
};

/** Adds named imports, reusing an existing declaration for the same module when present. */
export const addImports = (ms: MagicString, ast: Node, imports: readonly ImportSpec[]) => {
  const body = ((ast.program as Node).body as Node[]) ?? [];
  const decls = body.filter((n) => n.type === "ImportDeclaration");
  const importedNames = new Set<string>();
  for (const d of decls)
    for (const s of d.specifiers as Node[])
      importedNames.add(((s.local as Node).name as string) ?? "");
  const lastImport = decls[decls.length - 1];
  const insertAt = lastImport ? lastImport.end : 0;
  const additions: string[] = [];
  for (const spec of imports) {
    if (importedNames.has(spec.name)) continue;
    const existing = decls.find(
      (d) => (d.source as Node).value === spec.from && d.importKind !== "type",
    );
    if (existing && !spec.isDefault) {
      const named = (existing.specifiers as Node[]).filter((s) => s.type === "ImportSpecifier");
      const last = named[named.length - 1];
      if (last) ms.appendLeft(last.end, `, ${spec.name}`);
      else {
        const def = (existing.specifiers as Node[])[0];
        if (def) ms.appendLeft(def.end, `, { ${spec.name} }`);
      }
    } else {
      additions.push(
        spec.isDefault
          ? `import ${spec.name} from "${spec.from}";`
          : `import { ${spec.name} } from "${spec.from}";`,
      );
    }
    importedNames.add(spec.name);
  }
  if (additions.length)
    ms.appendLeft(
      insertAt,
      `${insertAt === 0 ? "" : "\n"}${additions.join("\n")}${insertAt === 0 ? "\n" : ""}`,
    );
};

/** Removes import specifiers whose local binding is no longer referenced. Bare imports stay. */
export const removeUnusedImports = (code: string): string => {
  const ast = parseTsx(code);
  const body = ((ast.program as Node).body as Node[]) ?? [];
  const decls = body.filter((n) => n.type === "ImportDeclaration");
  const used = new Map<string, number>();
  const count = (node: Node, inImport: boolean) => {
    if (node.type === "ImportDeclaration") inImport = true;
    if (!inImport && (node.type === "Identifier" || node.type === "JSXIdentifier")) {
      const n = node.name as string;
      used.set(n, (used.get(n) ?? 0) + 1);
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "range") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const v of value) if (isNode(v)) count(v, inImport);
      } else if (isNode(value)) count(value, inImport);
    }
  };
  count(ast, false);
  const ms = new MagicString(code);
  for (const d of decls) {
    const specs = d.specifiers as Node[];
    if (specs.length === 0) continue;
    const unused = specs.filter((s) => !used.has((s.local as Node).name as string));
    if (unused.length === 0) continue;
    if (unused.length === specs.length) {
      removeWithLine(ms, code, d.start, d.end);
      continue;
    }
    for (const s of unused) {
      const i = specs.indexOf(s);
      const next = specs[i + 1];
      const prev = specs[i - 1];
      if (next) ms.remove(s.start, next.start);
      else if (prev) ms.remove(prev.end, s.end);
      else ms.remove(s.start, s.end);
    }
  }
  return ms.toString();
};
