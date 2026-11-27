import { describe, expect, it } from "@effect/vitest";
import { Cause, Exit, Option, Schema } from "effect";
import { DesignNode } from "./document.ts";

const decode = Schema.decodeUnknownExit(DesignNode);

/** Why a node does not decode, as an agent is told. */
const refusalOf = (node: unknown) =>
  Exit.match(decode(node), {
    onFailure: (cause) =>
      Option.match(Cause.findErrorOption(cause), {
        onNone: () => "",
        onSome: (error) => error.message,
      }),
    onSuccess: () => "",
  });

describe("a node's size", () => {
  it("refused, names every form it takes and the fields a percentage or a token goes on", () => {
    for (const [field, value, lengths] of [
      ["width", "50%", ["maxWidth", "minWidth"]],
      ["width", "$container-3xl", ["maxWidth", "minWidth"]],
      ["height", "auto", ["maxHeight", "minHeight"]],
    ] as const) {
      const refusal = refusalOf({
        children: [],
        id: "c_1",
        type: "column",
        [field]: value,
      });
      for (const named of [
        `${field} takes`,
        "a number",
        '"fill"',
        '"hug"',
        ...lengths,
      ]) {
        expect(refusal, `${field}: ${value}`).toContain(named);
      }
    }
  });

  it("refused at a breakpoint, says the same", () => {
    expect(
      refusalOf({
        at: { md: { width: "50%" } },
        children: [],
        id: "c_1",
        type: "column",
      })
    ).toContain("maxWidth");
  });

  it("takes pixels, fill and hug", () => {
    for (const width of [320, "fill", "hug"]) {
      expect(
        Exit.isSuccess(
          decode({ children: [], id: "c_1", type: "column", width })
        ),
        String(width)
      ).toBe(true);
    }
  });
});
