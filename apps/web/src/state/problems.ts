/**
 * Problems (ADR 0106) as the stores have them now: the design system's files as read, and the
 * sync's plan. Worked out in `lib/problems.ts`; the rail, the place switch and the panel ask here.
 */
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { type Problem, problemsOf } from "../lib/problems.ts";
import { useDesignSystem } from "./design-system.ts";
import { useSync } from "./sync.ts";

const NONE: readonly never[] = [];

/** The problems as the stores have them now; the same list while nothing they read changes. */
export const useProblems = (): readonly Problem[] => {
  const { designSystemRead, document, notes, problem } = useDesignSystem(
    useShallow((s) => ({
      designSystemRead: s.designSystem !== null,
      document: s.document,
      notes: s.notes ?? NONE,
      problem: s.problem,
    }))
  );
  const plan = useSync((s) => s.plan);
  return useMemo(
    () => problemsOf({ designSystemRead, document, notes, plan, problem }),
    [designSystemRead, document, notes, plan, problem]
  );
};
