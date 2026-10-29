import {
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import type { TokenValues } from "@ultrapaint/contracts/token-table";
import { describe, expect, it } from "vitest";
import {
  readDesignSystem,
  readGivenDesignSystem,
  withAgreement,
  writeDesignSystem,
} from "./services/design-system-files.ts";

const ds: DesignSystem = {
  ...emptyDesignSystem(),
  colors: [
    {
      name: "Semantic",
      tokens: [
        {
          description: "Buttons and links.",
          name: "color-primary",
          value: "#3b82f6",
          values: { dark: "#60a5fa" },
        },
        { name: "color-surface", value: "#ffffff" },
      ],
    },
  ],
  radius: [{ name: "radius-lg", value: "0.5rem" }],
  themes: ["light", "dark"],
};

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const code = (...tokens: TokenValues[]): ReadonlyMap<string, TokenValues> =>
  new Map(tokens.map((t) => [t.name, t]));

const none = code();

describe("the design system's files", () => {
  it("reads back what it writes, the values in the tokens file only", () => {
    const texts = writeDesignSystem(ds);
    expect(texts.system).not.toContain("#3b82f6");
    expect(JSON.parse(texts.system).spacing).toEqual({});
    expect(readDesignSystem(texts, none)).toEqual({
      designSystem: ds,
      problem: null,
      tokensNotes: [],
      tokensProblem: null,
    });
    const read = readDesignSystem(texts, none).designSystem;
    const again = read && writeDesignSystem(read);
    // The same files, design-system.json's keys in the schema's order.
    expect(again?.tokens).toBe(texts.tokens);
    expect(JSON.parse(again?.system ?? "")).toEqual(JSON.parse(texts.system));
  });

  it("reads a legacy design-system.json's own values, the tokens file's winning over them", () => {
    const legacy = json(ds);
    expect(
      readDesignSystem({ system: legacy, tokens: null }, none).designSystem
    ).toEqual(ds);
    const { tokens } = writeDesignSystem({
      ...ds,
      colors: [
        { name: "Semantic", tokens: [{ name: "color-primary", value: "red" }] },
      ],
    });
    const read = readDesignSystem({ system: legacy, tokens }, none);
    const primary = read.designSystem?.colors[0]?.tokens[0];
    expect(primary?.value).toBe("red");
    // The other themes' values the tokens file does not have stay design-system.json's.
    expect(primary?.values).toEqual({ dark: "#60a5fa" });
    expect(read.designSystem?.colors[0]?.tokens[1]?.value).toBe("#ffffff");
  });

  it("reads a design-system.json that still notes its components, and writes it without them", () => {
    const { system, tokens } = writeDesignSystem(ds);
    const old = json({
      ...JSON.parse(system),
      components: { Button: { category: "Actions", exampleText: "Go" } },
    });
    const read = readDesignSystem({ system: old, tokens }, none);
    expect(read.problem).toBeNull();
    expect(read.designSystem).toEqual(ds);
    expect(writeDesignSystem(ds).system).not.toContain("components");
  });

  it("takes a value neither file has from the code", () => {
    const { system } = writeDesignSystem(ds);
    const read = readDesignSystem(
      { system, tokens: null },
      code(
        { name: "color-primary", value: "blue", values: { dark: "navy" } },
        { name: "radius-lg", value: "1rem" },
        { name: "spacing", value: "4px" }
      )
    );
    expect(read.designSystem?.colors[0]?.tokens[0]).toEqual({
      description: "Buttons and links.",
      name: "color-primary",
      value: "blue",
      values: { dark: "navy" },
    });
    expect(read.designSystem?.radius[0]?.value).toBe("1rem");
    expect(read.designSystem?.spacing.base).toBe("4px");
    // One the code does not declare either is empty.
    expect(read.designSystem?.colors[0]?.tokens[1]?.value).toBe("");
  });

  it("lists a token only the tokens file has where its kind goes", () => {
    const { system } = writeDesignSystem(ds);
    const { tokens } = writeDesignSystem({
      ...ds,
      shadows: [{ name: "shadow-sm", value: "0 1px 2px black" }],
      typography: {
        ...ds.typography,
        sizes: [{ name: "text-lg", value: "1.125rem" }],
      },
    });
    const read = readDesignSystem({ system, tokens }, none).designSystem;
    expect(read?.shadows).toEqual([
      { name: "shadow-sm", value: "0 1px 2px black" },
    ]);
    expect(read?.typography.sizes.map((t) => [t.name, t.value])).toEqual([
      ["text-lg", "1.125rem"],
    ]);
  });

  it("lists another tool's token where its kind goes, and says what it left out", () => {
    const written = writeDesignSystem(ds);
    const { system } = written;
    // Another tool adds two tokens of its own to the file.
    const tokens = json({
      ...JSON.parse(written.tokens),
      Corner: { sm: { $type: "dimension", $value: { unit: "px", value: 4 } } },
      opacity: { half: { $type: "number", $value: 0.5 } },
    });
    const read = readDesignSystem({ system, tokens }, none);
    expect(read.designSystem?.radius).toEqual([
      { name: "radius-lg", value: "0.5rem" },
      { name: "radius-sm", value: "4px" },
    ]);
    expect(read.tokensNotes).toEqual([
      expect.stringContaining("`opacity.half`"),
    ]);
  });

  it("says why a tokens file does not read, the values design-system.json's and the code's meanwhile", () => {
    const read = readDesignSystem(
      { system: json(ds), tokens: "{ not json" },
      code({ name: "color-surface", value: "#000" })
    );
    expect(read.tokensProblem).toContain("design.tokens.json is not JSON");
    expect(read.problem).toBeNull();
    expect(read.designSystem).toEqual(ds);
    const { system } = writeDesignSystem(ds);
    expect(
      readDesignSystem(
        { system, tokens: "[]]" },
        code({ name: "color-surface", value: "#000" })
      ).designSystem?.colors[0]?.tokens[1]?.value
    ).toBe("#000");
  });

  it("says why design-system.json does not read", () => {
    expect(
      readDesignSystem(
        { system: "{", tokens: writeDesignSystem(ds).tokens },
        none
      )
    ).toMatchObject({
      designSystem: null,
      problem: expect.stringContaining(
        "design-system.json is not valid: not JSON"
      ),
      tokensNotes: [],
      tokensProblem: null,
    });
    expect(
      readDesignSystem({ system: json({ colors: 3 }), tokens: null }, none)
        .problem
    ).toContain("design-system.json is not valid: ");
    expect(readDesignSystem({ system: null, tokens: null }, none)).toEqual({
      designSystem: null,
      problem: null,
      tokensNotes: [],
      tokensProblem: null,
    });
  });
});

describe("a design system a writer gives", () => {
  it("keeps the current design system's value where the writer leaves one out, else the code's", () => {
    // An agent that read design-system.json writes it back, a token added without a value.
    const given = JSON.parse(writeDesignSystem(ds).system) as {
      radius: { name: string }[];
    };
    given.radius.push({ name: "radius-sm" });
    const read = readGivenDesignSystem(given, {
      code: code(
        { name: "color-primary", value: "green" },
        { name: "radius-sm", value: "2px" }
      ),
      current: ds,
    });
    if ("problem" in read) {
      throw new Error(read.problem);
    }
    expect(read.designSystem.colors).toEqual(ds.colors);
    expect(read.designSystem.radius).toEqual([
      { name: "radius-lg", value: "0.5rem" },
      { name: "radius-sm", value: "2px" },
    ]);
    expect(read.designSystem.spacing.base).toBe("0.25rem");
  });

  it("keeps the values the writer gives, and says why one is not a design system", () => {
    const read = readGivenDesignSystem(
      {
        ...ds,
        radius: [{ name: "radius-lg", value: "1rem" }],
      },
      { code: none, current: ds }
    );
    expect("designSystem" in read && read.designSystem.radius).toEqual([
      { name: "radius-lg", value: "1rem" },
    ]);
    const bad = readGivenDesignSystem(
      { colors: "red" },
      {
        code: none,
        current: null,
      }
    );
    expect("problem" in bad && bad.problem).toContain(
      "the design system is not valid: "
    );
  });
});

describe("an agreement set in design-system.json", () => {
  it("sets what is agreed, the matches kept, the rest as the file has it", () => {
    const text = json({
      codeSync: { agreed: { "color-a": "#000" }, at: 1, matches: { m: 1 } },
      other: true,
    });
    expect(
      JSON.parse(
        withAgreement(text, "codeSync", { "color-b": "#fff" }, 5) ?? ""
      )
    ).toEqual({
      codeSync: { agreed: { "color-b": "#fff" }, at: 5, matches: { m: 1 } },
      other: true,
    });
    expect(
      JSON.parse(
        withAgreement(text, "designMd", { "colors.a": "#000" }, 7) ?? ""
      ).designMd
    ).toEqual({ agreed: { "colors.a": "#000" }, at: 7 });
  });

  it("leaves the file as it is when the side agrees on the same values already", () => {
    const text = json({
      codeSync: { agreed: { "color-a": "#000" }, at: 1 },
      other: true,
    });
    expect(withAgreement(text, "codeSync", { "color-a": "#000" }, 5)).toBe(
      text
    );
    // None kept is nothing agreed.
    expect(withAgreement(text, "designMd", {}, 5)).toBe(text);
    expect(withAgreement(text, "codeSync", {}, 5)).not.toBe(text);
  });

  it("leaves a file that is not there or does not read alone", () => {
    expect(withAgreement(null, "codeSync", {}, 1)).toBeNull();
    expect(withAgreement("{", "designMd", {}, 1)).toBeNull();
    expect(withAgreement("[]", "designMd", {}, 1)).toBeNull();
  });
});
