/** `configure`: no project is open. `init`: one is, and its design system is not imported. */
export type SetupNeed = "configure" | "init";

export interface SetupFacts {
  configured: boolean;
  /** Whether the design system has been read yet, and what was found. */
  designSystem: "loading" | "imported" | "missing";
  /** The user said "Not now" to `/init` for this repository, this session. */
  dismissed: boolean;
}

/** What an edit is asked about before it goes ahead, if anything. */
export const setupNeedOf = (facts: SetupFacts): SetupNeed | null => {
  if (!facts.configured) {
    return "configure";
  }
  // Still being read: an edit is not held up by a question that may not arise.
  if (facts.designSystem !== "missing" || facts.dismissed) {
    return null;
  }
  return "init";
};
