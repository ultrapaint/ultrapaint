import { PageDocument } from "@ultrapaint/contracts/document";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { compactSchema } from "./services/threads/compact-schema.ts";

const LENGTH = {
  anyOf: [
    {
      anyOf: [
        { type: "number" },
        { enum: ["Infinity", "-Infinity", "NaN"], type: "string" },
      ],
    },
    { type: "string" },
  ],
  description: "Pixels, a token or CSS.",
};

describe("compactSchema", () => {
  it("leaves out what a file never holds, and writes a part said three times once", () => {
    const optional = { anyOf: [LENGTH, { type: "null" }] };
    const compact = compactSchema({
      definitions: {},
      schema: {
        properties: { gap: optional, height: optional, width: optional },
        type: "object",
      },
    });
    expect(compact).toEqual({
      $defs: {
        D1: {
          anyOf: [{ type: "number" }, { type: "string" }],
          description: "Pixels, a token or CSS.",
        },
      },
      properties: {
        gap: { $ref: "#/$defs/D1" },
        height: { $ref: "#/$defs/D1" },
        width: { $ref: "#/$defs/D1" },
      },
      type: "object",
    });
  });

  it("keeps the page format's definitions reachable and a sixth of its size", () => {
    const document = Schema.toJsonSchemaDocument(PageDocument);
    const compact = JSON.stringify(compactSchema(document));
    expect(compact.length).toBeLessThan(JSON.stringify(document).length / 5);
    const defs = new Set(
      Object.keys((JSON.parse(compact) as { $defs: object }).$defs)
    );
    for (const [, name] of compact.matchAll(/"#\/\$defs\/([^"]+)"/g)) {
      expect(defs.has(name as string)).toBe(true);
    }
    expect(compact).not.toContain('"null"');
    expect(compact).not.toContain("Infinity");
  });
});
