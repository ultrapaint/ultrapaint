import { describe, expect, it } from "vitest";
import {
  type FillLayer,
  fillCss,
  fillLayers,
  placedInPercent,
  resolveFillTokens,
  stopPositions,
  tokensInFill,
} from "./fill.ts";

describe("a fill as layers", () => {
  it("reads a colour, a token and nothing", () => {
    expect(fillLayers("#ffffff")).toEqual([
      { color: "#ffffff", kind: "color" },
    ]);
    expect(fillLayers("$color-card")).toEqual([
      { color: "$color-card", kind: "color" },
    ]);
    expect(fillLayers(undefined)).toEqual([]);
  });

  it("reads each gradient's shape, angle, geometry, interpolation and stops, tokens and positions among them", () => {
    expect(
      fillLayers(
        "linear-gradient(45deg in oklab, $color-primary 10%, rgb(0 0 0 / 50%), transparent 90%)"
      )
    ).toEqual([
      {
        angle: 45,
        interpolation: "oklab",
        kind: "gradient",
        shape: "linear",
        stops: [
          { color: "$color-primary", position: "10%" },
          { color: "rgb(0 0 0 / 50%)" },
          { color: "transparent", position: "90%" },
        ],
      },
    ]);
    expect(fillLayers("linear-gradient(to top right, red, blue)")).toEqual([
      {
        kind: "gradient",
        shape: "linear",
        side: "to top right",
        stops: [{ color: "red" }, { color: "blue" }],
      },
    ]);
    expect(
      fillLayers("radial-gradient(circle at top, $color-accent, transparent)")
    ).toEqual([
      {
        geometry: "circle at top",
        kind: "gradient",
        shape: "radial",
        stops: [{ color: "$color-accent" }, { color: "transparent" }],
      },
    ]);
    expect(
      fillLayers("conic-gradient(from 0.25turn at 50% 50%, red, blue 50%, red)")
    ).toEqual([
      {
        angle: 90,
        geometry: "at 50% 50%",
        kind: "gradient",
        shape: "conic",
        stops: [
          { color: "red" },
          { color: "blue", position: "50%" },
          { color: "red" },
        ],
      },
    ]);
  });

  it("reads several layers, the top one first, a flat gradient above another as a colour", () => {
    expect(
      fillLayers(
        "linear-gradient(#0003, #0003), radial-gradient($color-glow, transparent), $color-bg"
      )
    ).toEqual([
      { color: "#0003", kind: "color" },
      {
        kind: "gradient",
        shape: "radial",
        stops: [{ color: "$color-glow" }, { color: "transparent" }],
      },
      { color: "$color-bg", kind: "color" },
    ]);
  });

  it("keeps a value it cannot read as one layer as it is: an image, a colour under nothing, CSS it does not know", () => {
    for (const css of [
      // A variable may hold a gradient as well as a colour.
      "var(--hero, linear-gradient(red, blue))",
      "url(hero.png) center / cover, $color-bg",
      "red, blue",
      "repeating-linear-gradient(red 0 10px, blue 10px 20px)",
      "linear-gradient(red, 30%, blue)",
      "linear-gradient(red,,blue)",
      "none",
    ]) {
      expect(fillLayers(css)).toEqual([{ css, kind: "css" }]);
      expect(fillCss(fillLayers(css))).toBe(css);
    }
  });

  it("writes layers back as one background, a colour above another as a flat gradient", () => {
    const layers: FillLayer[] = [
      { color: "#0003", kind: "color" },
      {
        angle: 90,
        interpolation: "oklab",
        kind: "gradient",
        shape: "linear",
        stops: [
          { color: "$color-primary", position: "0%" },
          { color: "$color-accent", position: "40%" },
          { color: "transparent", position: "100%" },
        ],
      },
      {
        angle: 45,
        geometry: "at 25% 25%",
        kind: "gradient",
        shape: "conic",
        stops: [{ color: "red" }, { color: "blue" }],
      },
      { color: "$color-bg", kind: "color" },
    ];
    // A first stop at 0% and a last one at 100% are where CSS puts them anyway.
    expect(fillCss(layers)).toBe(
      "linear-gradient(#0003, #0003), linear-gradient(90deg in oklab, $color-primary, $color-accent 40%, transparent), conic-gradient(from 45deg at 25% 25%, red, blue), $color-bg"
    );
    expect(fillLayers(fillCss(layers) ?? "")).toEqual([
      layers[0],
      {
        ...layers[1],
        stops: [
          { color: "$color-primary" },
          { color: "$color-accent", position: "40%" },
          { color: "transparent" },
        ],
      },
      layers[2],
      layers[3],
    ]);
    expect(fillCss([])).toBeNull();
    // Over a colour written apart, a colour is an image too.
    expect(
      fillCss([{ color: "#0003", kind: "color" }], { bottom: false })
    ).toBe("linear-gradient(#0003, #0003)");
  });

  it("keeps an angle as written, to its last digit", () => {
    const fill = "conic-gradient(from 12.345deg, red, blue)";
    expect(fillCss(fillLayers(fill))).toBe(fill);
  });

  it("reads a gradient of one variable twice as a gradient, which it may be", () => {
    expect(
      fillLayers(
        "linear-gradient(var(--stop, red 20%), var(--stop, red 20%)), $color-bg"
      )[0]?.kind
    ).toBe("gradient");
  });

  it("places a stop without a position exactly between its neighbours", () => {
    expect(
      stopPositions([
        { color: "a", position: "10.001%" },
        { color: "b" },
        { color: "c", position: "10.003%" },
      ])[1]
    ).toBeCloseTo(10.002, 6);
  });

  it("places a conic gradient's stop given as an angle at its share of the turn", () => {
    const stops = [
      { color: "a", position: "0deg" },
      { color: "b", position: "90deg" },
      { color: "c", position: "0.5turn" },
    ];
    expect(stopPositions(stops, "conic")).toEqual([0, 25, 50]);
    expect(placedInPercent(stops, "conic")).toBe(true);
  });

  it("cannot place a stop in percent that is given in a length", () => {
    const stops = [{ color: "a", position: "10px" }, { color: "b" }];
    expect(placedInPercent(stops, "linear")).toBe(false);
    expect(placedInPercent([{ color: "a", position: "90deg" }], "linear")).toBe(
      false
    );
  });

  it("places each stop where CSS draws it, one without a position between its neighbours", () => {
    expect(
      stopPositions([
        { color: "a" },
        { color: "b" },
        { color: "c", position: "80%" },
        { color: "d" },
      ])
    ).toEqual([0, 40, 80, 100]);
    expect(
      stopPositions([
        { color: "a", position: "60%" },
        { color: "b", position: "20%" },
      ])
    ).toEqual([60, 60]);
    expect(
      stopPositions([{ color: "a" }, { color: "b" }, { color: "c" }])
    ).toEqual([0, 50, 100]);
    expect(
      stopPositions([
        { color: "a", position: "20%" },
        { color: "b" },
        { color: "c", position: "60%" },
        { color: "d" },
        { color: "e" },
      ])
    ).toEqual([20, 40, 60, 80, 100]);
  });
});

describe("the tokens of a fill", () => {
  it("are every token it names, wherever in it", () => {
    expect(
      tokensInFill(
        "linear-gradient(in oklab, $color-primary 10%, $color-accent), url(a$b.png), $color-bg"
      )
    ).toEqual(["color-primary", "color-accent", "color-bg"]);
  });

  it("are none in a path or a quoted string that holds a `$`", () => {
    expect(
      tokensInFill(
        'url(/img/$hero.png), url($hero.png), url("$a b.png"), $color-bg'
      )
    ).toEqual(["color-bg"]);
  });

  it("are drawn as their variables, a path's `$` left as it is", () => {
    expect(
      resolveFillTokens("url($hero.png), $color-bg", (n) => `var(--${n})`)
    ).toBe("url($hero.png), var(--color-bg)");
  });

  it("are none in a comment or past an escaped quote", () => {
    const fill =
      'linear-gradient(/* $example */ $color-a, $color-b), url("a\\" ) $hero.png")';
    expect(tokensInFill(fill)).toEqual(["color-a", "color-b"]);
    expect(resolveFillTokens(fill, (n) => `var(--${n})`)).toBe(
      'linear-gradient(/* $example */ var(--color-a), var(--color-b)), url("a\\" ) $hero.png")'
    );
  });

  it("are none in a quoted path that holds a bracket", () => {
    const fill = 'url("a) $hero.png"), $color-bg';
    expect(tokensInFill(fill)).toEqual(["color-bg"]);
    expect(resolveFillTokens(fill, (n) => `var(--${n})`)).toBe(
      'url("a) $hero.png"), var(--color-bg)'
    );
  });

  it("are drawn as their variables", () => {
    expect(
      resolveFillTokens(
        "linear-gradient($color-primary, $color-accent 50%), $color-bg",
        (name) => `var(--${name})`
      )
    ).toBe(
      "linear-gradient(var(--color-primary), var(--color-accent) 50%), var(--color-bg)"
    );
  });
});
