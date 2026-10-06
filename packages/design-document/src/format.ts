/**
 * How a design document is written to disk: one node per line. A node's own fields sit on its
 * line, its children follow one level deeper, each on a line of its own. A change in the
 * inspector is then a change to one line of the file, a reviewer reads the tree from its
 * indentation, and the file stays JSON: anything that reads JSON reads it, and reading it back
 * gives exactly the document that was written.
 *
 * A node's fields are written in one order whatever order the editor made them in: `type`, `id`
 * and `name` first, the rest by name, `children` last. Writing the same document twice gives the
 * same bytes.
 */

const LEADING = ["type", "id", "name"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const byNodeOrder = (a: string, b: string) => {
  const ia = LEADING.indexOf(a);
  const ib = LEADING.indexOf(b);
  if (ia !== -1 || ib !== -1) {
    return (
      (ia === -1 ? LEADING.length : ia) - (ib === -1 ? LEADING.length : ib)
    );
  }
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
};

/** A value inside a node's line: JSON with a space after every comma and colon. */
const inline = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(inline).join(", ")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(", ")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

/** A node on its line at `indent`, its children below it. */
const node = (value: unknown, indent: string): string => {
  if (!isRecord(value)) {
    return indent + inline(value);
  }
  const { children, ...own } = value;
  const fields = Object.keys(own)
    .filter((key) => own[key] !== undefined)
    .sort(byNodeOrder)
    .map((key) => `${JSON.stringify(key)}: ${inline(own[key])}`);
  if (!Array.isArray(children)) {
    if (children !== undefined) {
      fields.push(`"children": ${inline(children)}`);
    }
    return `${indent}{${fields.join(", ")}}`;
  }
  if (children.length === 0) {
    return `${indent}{${[...fields, '"children": []'].join(", ")}}`;
  }
  const inner = nodes(children, `${indent}  `);
  return `${indent}{${[...fields, '"children": ['].join(", ")}\n${inner}\n${indent}]}`;
};

const nodes = (list: readonly unknown[], indent: string) =>
  list.map((n) => node(n, indent)).join(",\n");

/** A field of the file itself: a page's `root`, a canvas's loose `nodes`, or anything else. */
const field = (key: string, value: unknown): string => {
  if (key === "root" && isRecord(value)) {
    return node(value, "  ").trimStart();
  }
  if (key === "nodes" && Array.isArray(value) && value.length > 0) {
    return `[\n${nodes(value, "    ")}\n  ]`;
  }
  return JSON.stringify(value, null, 2).replaceAll("\n", "\n  ");
};

/**
 * The file contents of a page (`{ root, version }`) or a canvas's `canvas.json`: the file's own
 * fields in the order given, the nodes one per line, one trailing newline.
 */
export const serialiseDocument = (value: unknown): string => {
  if (!isRecord(value)) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    return "{}\n";
  }
  const body = entries
    .map(([key, v]) => `  ${JSON.stringify(key)}: ${field(key, v)}`)
    .join(",\n");
  return `{\n${body}\n}\n`;
};
