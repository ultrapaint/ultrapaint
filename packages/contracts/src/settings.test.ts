import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ProjectConfig } from "./settings.ts";

describe("a configuration file", () => {
  it("still reads with a field that is no setting any more, which is dropped", () => {
    const config = Schema.decodeUnknownSync(ProjectConfig)({
      designsDir: "docs/designs",
      framework: "react-vite",
      providersModule: "providers.tsx",
      storybookUrl: "http://localhost:6006",
    });
    expect(config).toEqual({ designsDir: "docs/designs" });
  });
});
