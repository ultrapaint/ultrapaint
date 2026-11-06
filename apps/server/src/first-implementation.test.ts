import { describe, expect, it } from "@effect/vitest";
import {
  LOOK_PRESETS,
  lookSystem,
} from "@ultrapaint/design-document/look-dials";
import { agentWays } from "./services/threads/agent-ways.ts";
import { stackStep } from "./services/threads/first-implementation.ts";

const [calm] = LOOK_PRESETS;

describe("the first implementation of a designs-only project", () => {
  it("asks for the stack, its choices filled in from the design system", () => {
    if (!calm) {
      return;
    }
    const text = stackStep(
      lookSystem({ ...calm.dials, iconStroke: "light", tokens: "detailed" }),
      agentWays(true)
    );
    expect(text).toContain("with ask_user");
    expect(text).toContain("Figtree, from @fontsource-variable/figtree");
    expect(text).toContain("strokeWidth 1.5");
    expect(text).toContain("--text-color-*");
    expect(text).toContain("call save_setup with stylesheet");
  });

  it("names no face or namespace the design system does not have", () => {
    const text = stackStep(null, agentWays(false));
    expect(text).toContain("the system's own sans");
    expect(text).toContain("strokeWidth 2");
    expect(text).not.toContain("--text-color-*");
    expect(text).not.toContain("save_setup");
  });
});
