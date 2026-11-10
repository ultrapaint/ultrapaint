import { assert, describe, it } from "@effect/vitest";
import { axeFindings } from "./axe.ts";

describe("axe-core's measurements", () => {
  it("gives a contrast finding the ratio axe measured, the colours and what it expected", () => {
    assert.deepStrictEqual(
      axeFindings([
        {
          certain: true,
          data: {
            bgColor: "#ffffff",
            contrastRatio: 2.84,
            expectedContrastRatio: "4.5:1",
            fgColor: "#999999",
          },
          html: "<p>",
          rule: "color-contrast",
          target: "p.hint",
        },
      ]),
      [
        {
          certain: true,
          detail: "2.84:1, #999999 on #ffffff, under 4.5:1",
          label: "p.hint",
          rule: "color-contrast",
          value: 2.84,
        },
      ]
    );
  });

  it("keeps what axe could not measure, to be confirmed", () => {
    const [finding] = axeFindings([
      {
        certain: false,
        data: null,
        html: "<h1>",
        rule: "color-contrast",
        target: "h1",
      },
    ]);
    assert.strictEqual(finding?.certain, false);
    assert.strictEqual(finding?.value, 0);
    assert.include(finding?.detail ?? "", "not measured");
  });

  it("gives a target its smaller side, and leaves other rules out", () => {
    assert.deepStrictEqual(
      axeFindings([
        {
          certain: true,
          data: { height: 16, minSize: 24, width: 40 },
          html: "<button>",
          rule: "target-size",
          target: "button.close",
        },
        { certain: true, data: null, html: "", rule: "label", target: "input" },
      ]),
      [
        {
          certain: true,
          detail: "40×16px, under 24×24",
          label: "button.close",
          rule: "target-size",
          value: 16,
        },
      ]
    );
  });
});
