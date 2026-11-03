import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import { briefAnswer } from "./brief.ts";
import { componentJudgementAnswer } from "./component-judge.ts";
import { familyComponentsAnswer } from "./extract.ts";
import { Judgement, judgementAnswer } from "./judge.ts";
import { learnedAnswer } from "./learn.ts";
import { verdictAnswer } from "./pairwise.ts";
import { piecesAnswer } from "./patterns.ts";
import { synthesisAnswer } from "./report.ts";
import { designSectionsAnswer, referenceSectionsAnswer } from "./sections.ts";
import { siteNotesAnswer, studyReferenceAnswer } from "./study.ts";

/** The part of JSON Schema the answers are asked in. */
interface JsonSchema {
  readonly enum?: readonly string[];
  readonly items?: JsonSchema;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly type?: string;
}
const JsonSchema: Schema.Codec<JsonSchema> = Schema.Struct({
  enum: Schema.optionalKey(Schema.Array(Schema.String)),
  items: Schema.optionalKey(
    Schema.suspend((): Schema.Codec<JsonSchema> => JsonSchema)
  ),
  properties: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.suspend((): Schema.Codec<JsonSchema> => JsonSchema)
    )
  ),
  type: Schema.optionalKey(Schema.String),
});

/** An answer that fits a JSON Schema, every property there, every array with one item. */
const answerTo = (schema: JsonSchema): unknown => {
  if (schema.enum) {
    return schema.enum[0];
  }
  switch (schema.type) {
    case "object":
      return Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, property]) => [
          key,
          answerTo(property),
        ])
      );
    case "array":
      return schema.items ? [answerTo(schema.items)] : [];
    case "boolean":
      return true;
    case "integer":
    case "number":
      return 3;
    default:
      return "words";
  }
};

const SKILLS = ["design", "layout"];
const ANSWERS = {
  brief: briefAnswer,
  "component judgement": componentJudgementAnswer,
  "design sections": designSectionsAnswer(["Hero", "Pricing"]),
  "family components": familyComponentsAnswer,
  judgement: judgementAnswer(SKILLS),
  learned: learnedAnswer,
  pairwise: verdictAnswer,
  pieces: piecesAnswer,
  "reference sections": referenceSectionsAnswer,
  "site notes": siteNotesAnswer,
  "study reference": studyReferenceAnswer,
  synthesis: synthesisAnswer(SKILLS),
};

describe("a model's answer", () => {
  it.each(Object.entries(ANSWERS))(
    "%s: one that fits the JSON Schema the model is told decodes whole",
    (_, answer) => {
      const fitting = answerTo(
        Schema.decodeUnknownSync(JsonSchema)(answer.schema)
      );
      assert.deepStrictEqual(
        Schema.decodeUnknownSync(answer.decode)(fitting, {
          onExcessProperty: "error",
        }),
        fitting
      );
    }
  );

  // A judge.json from before the levels and the added texts: no `level`, no `addedText`.
  const older = {
    fidelity: { added: [], missing: ["the footer"] },
    findings: [
      {
        coverage: "not-covered",
        evidence: "desktop-01.jpg",
        generated: "a centred column",
        impact: "high",
        reference: "a two-column layout",
        rule: "Use the width",
        skill: "layout",
        title: "Wasted width",
        viewport: "desktop",
      },
    ],
    scores: [{ area: "layout-skill", note: "", score: 2 }],
    strengths: [],
    summary: "Narrow.",
  };

  it("a judgement from before the levels and the added texts still decodes", () => {
    const decoded: unknown = Schema.decodeUnknownSync(Judgement)(older);
    assert.deepStrictEqual(decoded, older);
  });

  it("a finding with a coverage the judge was not offered is no judgement", () => {
    const findings = older.findings.map((f) => ({ ...f, coverage: "maybe" }));
    assert.isTrue(
      Exit.isFailure(
        Schema.decodeUnknownExit(Judgement)({ ...older, findings })
      )
    );
  });
});
