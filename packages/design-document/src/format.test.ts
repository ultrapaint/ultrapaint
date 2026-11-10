import { describe, expect, it } from "@effect/vitest";
import { PageDocument } from "@ultrapaint/contracts/document";
import { Arbitrary, Effect } from "effect";
import { serialise } from "./factories.ts";
import { serialiseDocument } from "./format.ts";

/** JSON with every object's keys sorted: equal for equal documents, whatever their field order. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
        )
      : v
  );

describe("serialiseDocument", () => {
  it("writes a node per line, its fields in a fixed order", () => {
    const text = serialiseDocument({
      root: {
        children: [
          {
            children: [
              { id: "t", role: "paragraph", text: "Orders", type: "text" },
            ],
            gap: 8,
            id: "r",
            name: "Header",
            padding: { left: 12, top: 7 },
            type: "row",
          },
          { children: [], id: "g", type: "group" },
        ],
        id: "root",
        type: "page",
      },
      version: 1,
    });
    expect(text).toBe(
      `{
  "root": {"type": "page", "id": "root", "children": [
    {"type": "row", "id": "r", "name": "Header", "gap": 8, "padding": {"left": 12, "top": 7}, "children": [
      {"type": "text", "id": "t", "role": "paragraph", "text": "Orders"}
    ]},
    {"type": "group", "id": "g", "children": []}
  ]},
  "version": 1
}
`
    );
  });

  it("writes a canvas's loose nodes one per line and its other fields as before", () => {
    const text = serialiseDocument({
      frames: { "a.page.json": { height: 900, width: 1440, x: 0, y: 0 } },
      name: "Flows",
      nodes: [{ id: "t", role: "paragraph", text: "Note", type: "text", x: 4 }],
      version: 1,
    });
    expect(text).toBe(
      `{
  "frames": {
    "a.page.json": {
      "height": 900,
      "width": 1440,
      "x": 0,
      "y": 0
    }
  },
  "name": "Flows",
  "nodes": [
    {"type": "text", "id": "t", "role": "paragraph", "text": "Note", "x": 4}
  ],
  "version": 1
}
`
    );
  });

  it.effect("reads every page back as the previous format did", () =>
    Effect.gen(function* () {
      const result = yield* Arbitrary.checkEffect(
        Arbitrary.schema(PageDocument),
        (document) =>
          canonical(JSON.parse(serialiseDocument(document))) ===
          canonical(JSON.parse(serialise(document))),
        // Seeded: the same 300 documents every run, so a failure is one that fails again.
        { runs: 300, seed: "serialiseDocument", size: 12 }
      );
      expect(Arbitrary.formatCheckFailure(result)).toBeUndefined();
    })
  );
});
