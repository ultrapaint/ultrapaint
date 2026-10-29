/**
 * `configure`: no project is open. A project with no design system is no reason to wait: the
 * canvas draws on the system components' neutral theme (ADR 0040), and Sync offers to make one.
 */
export type SetupNeed = "configure";

export interface SetupFacts {
  configured: boolean;
}

/** What an edit is asked about before it goes ahead, if anything. */
export const setupNeedOf = (facts: SetupFacts): SetupNeed | null =>
  facts.configured ? null : "configure";
