/**
 * A JSON Schema as an agent reads it, cut down to what it says (`toJsonSchemaDocument`'s output
 * repeats itself): an optional field's `null` and a number's "NaN" and "Infinity" strings go, as a
 * file holds neither; an `anyOf` inside an `anyOf` is one list, and a list of one is its member;
 * and a part written three times or more is written once, in `$defs`, and referred to. The
 * schema still validates every document it did.
 */
import type { JsonSchema } from "effect";

type Json = JsonSchema.JsonSchema;

/** A number's strings that a file never holds. */
const NOT_A_NUMBER = ["Infinity", "-Infinity", "NaN"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a schema is `null`, or a number's "NaN" and "Infinity" strings. */
const unwritten = (schema: unknown) =>
  isObject(schema) &&
  (schema.type === "null" ||
    (schema.type === "string" &&
      Array.isArray(schema.enum) &&
      schema.enum.every((v) => NOT_A_NUMBER.includes(v as string))));

/** The schema with what a file never holds left out, and its `anyOf`s flat. */
const simplified = (schema: unknown): unknown => {
  if (Array.isArray(schema)) {
    return schema.map(simplified);
  }
  if (!isObject(schema)) {
    return schema;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    out[key] = simplified(value);
  }
  if (!Array.isArray(out.anyOf)) {
    return out;
  }
  const members = (out.anyOf as unknown[])
    .filter((m) => !unwritten(m))
    .flatMap((m) =>
      isObject(m) && Array.isArray(m.anyOf) && Object.keys(m).length === 1
        ? (m.anyOf as unknown[])
        : [m]
    );
  const { anyOf: _anyOf, ...rest } = out;
  const [only] = members;
  if (members.length === 1 && isObject(only)) {
    // A list of one is its member, with what was said beside the list.
    return { ...only, ...rest };
  }
  return { ...rest, anyOf: members };
};

/** Every object of the schema, written as JSON, with how often it is written. */
const counted = (schema: unknown, into: Map<string, number>) => {
  if (Array.isArray(schema)) {
    for (const item of schema) {
      counted(item, into);
    }
    return;
  }
  if (!isObject(schema)) {
    return;
  }
  const text = JSON.stringify(schema);
  into.set(text, (into.get(text) ?? 0) + 1);
  for (const value of Object.values(schema)) {
    counted(value, into);
  }
};

/** The schema with every object written as `text` replaced by `ref`. */
const replaced = (schema: unknown, text: string, ref: Json): unknown => {
  if (Array.isArray(schema)) {
    return schema.map((item) => replaced(item, text, ref));
  }
  if (!isObject(schema)) {
    return schema;
  }
  if (JSON.stringify(schema) === text) {
    return ref;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    out[key] = replaced(value, text, ref);
  }
  return out;
};

/** A part written at least this often, and this long, is written once in `$defs`. */
const MIN_REPEATS = 3;
const MIN_LENGTH = 40;

/**
 * A schema document (`toJsonSchemaDocument`'s `schema` and `definitions`) as one schema, its
 * definitions and its repeated parts in `$defs`.
 */
export const compactSchema = (document: {
  readonly definitions: Readonly<Record<string, Json>>;
  readonly schema: Json;
}): Json => {
  let defs = simplified(document.definitions) as Record<string, unknown>;
  let root = simplified(document.schema);
  for (let n = 1; ; n += 1) {
    const counts = new Map<string, number>();
    counted([root, defs], counts);
    let best: { saves: number; text: string } | null = null;
    for (const [text, count] of counts) {
      const saves = (count - 1) * text.length;
      if (
        count >= MIN_REPEATS &&
        text.length >= MIN_LENGTH &&
        (best === null || saves > best.saves)
      ) {
        best = { saves, text };
      }
    }
    if (best === null) {
      break;
    }
    const name = `D${n}`;
    const ref = { $ref: `#/$defs/${name}` };
    root = replaced(root, best.text, ref);
    defs = replaced(defs, best.text, ref) as Record<string, unknown>;
    defs[name] = JSON.parse(best.text);
  }
  return { ...(root as Record<string, unknown>), $defs: defs } as Json;
};
