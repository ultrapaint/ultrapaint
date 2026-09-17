import { parse } from "@babel/parser";
import MagicString from "magic-string";

export interface StampOptions {
  /** Path written into the stamp, normally repository-relative with posix separators. */
  file: string;
  /** Attribute name; defaults to `data-ed`. */
  attribute?: string;
  /** Source name written into the map; defaults to `file`. Vite wants the absolute path. */
  mapSource?: string;
}

export interface StampResult {
  code: string;
  map: ReturnType<MagicString["generateMap"]>;
  count: number;
}

interface AstNode {
  type: string;
  start?: number | null;
  end?: number | null;
  loc?: { start: { line: number; column: number } } | null;
  [key: string]: unknown;
}

const isNode = (v: unknown): v is AstNode =>
  typeof v === "object" && v !== null && typeof (v as AstNode).type === "string";

/**
 * Adds `data-ed="<file>:<line>:<col>"` to every JSX opening element (not fragments) so the
 * rendered DOM and React fibers can be traced back to their source. Line is 1-based, column
 * 0-based, both pointing at the `<` of the element. Existing content is untouched; the result
 * carries a high-resolution source map so downstream tools keep exact positions.
 */
export const stampJsx = (code: string, options: StampOptions): StampResult => {
  const attribute = options.attribute ?? "data-ed";
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript", "decorators-legacy"],
    errorRecovery: true,
    ranges: true,
  });
  const ms = new MagicString(code);
  let count = 0;

  const visit = (node: AstNode) => {
    if (node.type === "JSXOpeningElement") {
      const name = node.name as AstNode;
      const attrs = (node.attributes as AstNode[]) ?? [];
      const alreadyStamped = attrs.some(
        (a) => a.type === "JSXAttribute" && ((a.name as AstNode)?.name as string) === attribute,
      );
      if (!alreadyStamped && node.loc) {
        // Insert after the tag name, or after type arguments when present.
        const typeArgs = (node.typeParameters ?? node.typeArguments) as AstNode | undefined;
        const insertAt = (typeArgs?.end ?? name.end) as number;
        const { line, column } = node.loc.start;
        ms.appendLeft(insertAt, ` ${attribute}="${options.file}:${line}:${column}"`);
        count += 1;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "leadingComments" || key === "trailingComments") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const v of value) if (isNode(v)) visit(v);
      } else if (isNode(value)) {
        visit(value);
      }
    }
  };
  visit(ast as unknown as AstNode);

  return {
    code: ms.toString(),
    map: ms.generateMap({
      hires: true,
      source: options.mapSource ?? options.file,
      includeContent: true,
    }),
    count,
  };
};
