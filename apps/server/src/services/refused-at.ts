/**
 * Why operations or a document did not decode, each refusal placed as the agent wrote it (UP-242):
 * the operation by its place in `ops` and its kind, the node by its id and name, then the field,
 * where the schema's own path counts child indexes through the tree.
 */
import { Predicate, type Schema, SchemaIssue } from "effect";

const issuesOf = SchemaIssue.makeFormatterStandardSchemaV1();

/** A design node as written: an object with an id and a type (an operation has no type). */
const nodeLabel = (value: unknown) =>
  Predicate.isObject(value) &&
  typeof value.id === "string" &&
  typeof value.type === "string"
    ? `node ${JSON.stringify(value.id)}${typeof value.name === "string" ? ` (${JSON.stringify(value.name)})` : ""}`
    : undefined;

/** A field's path inside a node: `width`, `at.md.width`, `padding.top`. */
const fieldPath = (keys: readonly PropertyKey[]) =>
  keys
    .map((key, i) =>
      typeof key === "number"
        ? `[${key}]`
        : `${i === 0 ? "" : "."}${String(key)}`
    )
    .join("");

/**
 * Where `path` points in `input`: the operation when `ops` names the list the input is, the
 * deepest node on the way, and the field from there.
 */
const placeOf = (
  input: unknown,
  path: readonly PropertyKey[],
  ops: string | undefined
) => {
  const parts: string[] = [];
  let value = input;
  let from = 0;
  const [first] = path;
  if (ops !== undefined && typeof first === "number") {
    value = Array.isArray(input) ? input[first] : undefined;
    const kind =
      Predicate.isObject(value) && typeof value.op === "string"
        ? ` (${value.op})`
        : "";
    parts.push(`${ops}[${first}]${kind}`);
    from = 1;
  }
  let node: string | undefined;
  for (const [i, key] of path.entries()) {
    if (i < from) {
      continue;
    }
    value = Predicate.isObjectOrArray(value)
      ? (value as Record<PropertyKey, unknown>)[key]
      : undefined;
    const label = nodeLabel(value);
    if (label !== undefined) {
      node = label;
      from = i + 1;
    }
  }
  if (node !== undefined) {
    parts.push(node);
  }
  const field = fieldPath(path.slice(from));
  if (field !== "") {
    parts.push(field);
  }
  return parts.join(", ");
};

/**
 * A decode's refusal, one line per issue and the place under it, each said once, as Effect's own
 * message reads but placed by `placeOf`. `ops` names the list of operations `input` is, if it is.
 */
export const refusedAt = (
  error: Schema.SchemaError,
  input: unknown,
  ops?: string
): string => {
  const lines = issuesOf(error.issue).issues.map(({ message, path = [] }) => {
    const keys = path.map((segment) =>
      typeof segment === "object" ? segment.key : segment
    );
    const place = placeOf(input, keys, ops);
    return place === "" ? message : `${message}\n  at ${place}`;
  });
  // Members of a union that fail alike say the same once.
  return [...new Set(lines)].join("\n");
};
