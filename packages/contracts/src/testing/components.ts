/**
 * Component files for tests (ADR 0041), over the contract's types: what a test builds its own
 * world from, kept out of the modules production code imports.
 */
import type { SystemComponentFile } from "../components.ts";

/** A system component's file that sets nothing: drawn in its default look. */
export const emptySystemComponent = (name: string): SystemComponentFile => ({
  base: {},
  name,
  origin: "system",
  states: {},
  variants: {},
  version: 1,
});
