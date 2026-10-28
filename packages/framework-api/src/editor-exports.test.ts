import { describe, expectTypeOf, it } from "vitest";
import type { EditorBundle, EditorEntry } from "./browser.ts";
import type {
  EDITOR_BUNDLE_EXPORTS,
  EDITOR_ENTRY_EXPORTS,
} from "./editor-exports.ts";

// Checked as the package compiles: a name renamed, added or left out on either side fails it.
describe("the editor entry's and bundle's names", () => {
  it("are their shapes' keys, every one", () => {
    expectTypeOf<(typeof EDITOR_ENTRY_EXPORTS)[number]>().toEqualTypeOf<
      keyof EditorEntry
    >();
    expectTypeOf<(typeof EDITOR_BUNDLE_EXPORTS)[number]>().toEqualTypeOf<
      keyof EditorBundle
    >();
  });
});
