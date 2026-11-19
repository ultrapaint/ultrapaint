/**
 * Problems (ADR 0106) as the stores have them now: the design system's files as read, and the
 * sync's plan, worked out in `lib/problems.ts`; less the ones left as they are, for the project
 * (its settings, `ignoredProblems`, shared with the team) or for the person alone (their
 * profile, by project). The rail, the place switch and the panel ask for the ones to fix;
 * Settings lists the ones left.
 */
import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { type Problem, problemsOf } from "../lib/problems.ts";
import { saveWith } from "../lib/settings-actions.ts";
import { api } from "./connection.ts";
import { useDesignSystem } from "./design-system.ts";
import { reportError, useProject } from "./project.ts";
import { useSync } from "./sync.ts";

const NONE: readonly never[] = [];

/** Whose choice it was to leave a problem as it is. */
export type IgnoredBy = "me" | "project";

/**
 * The profile's preference a project's own ignored problems are kept under, by its repository's
 * path: one name per project, which the server merges one name at a time, so a save from one
 * project's editor never writes over another's.
 */
export const IGNORED_PREFIX = "ignoredProblems:";

interface PersonalIgnores {
  /** The problems the person left, by project (its repository's path), by the problems' ids. */
  readonly byProject: Readonly<Record<string, readonly string[]>>;
  /** The projects whose list was set here since the editor started: the profile's is older. */
  readonly changed: ReadonlySet<string>;
  /** One project's list, set here. */
  readonly set: (repo: string, ids: readonly string[]) => void;
  /** The lists the profile holds, but those set here meanwhile. */
  readonly take: (
    byProject: Readonly<Record<string, readonly string[]>>
  ) => void;
}

/** What the person left as it is, kept in their profile (ADR 0093, 0106). */
export const usePersonalIgnores = create<PersonalIgnores>((set) => ({
  byProject: {},
  changed: new Set(),
  set: (repo, ids) =>
    set((s) => ({
      byProject: { ...s.byProject, [repo]: ids },
      changed: new Set([...s.changed, repo]),
    })),
  take: (kept) =>
    set((s) => ({
      byProject: {
        ...s.byProject,
        ...Object.fromEntries(
          Object.entries(kept).filter(([repo]) => !s.changed.has(repo))
        ),
      },
    })),
}));

/** A kept value as a list of ids: anything else is none. */
export const idsOf = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];

/** Every problem as the stores have them now, the ones left as they are included. */
const useAllProblems = (): readonly Problem[] => {
  const { designSystemRead, document, notes, problem } = useDesignSystem(
    useShallow((s) => ({
      designSystemRead: s.designSystem !== null,
      document: s.document,
      notes: s.notes ?? NONE,
      problem: s.problem,
    }))
  );
  const designsDir = useProject((s) => s.settings?.designsDir ?? "");
  const plan = useSync((s) => s.plan);
  return useMemo(
    () =>
      problemsOf({
        designSystemRead,
        designsDir,
        document,
        notes,
        plan,
        problem,
      }),
    [designSystemRead, designsDir, document, notes, plan, problem]
  );
};

/** Who left each problem, by its id: the project's choice wins over the person's. */
const useIgnoredBy = (): ReadonlyMap<string, IgnoredBy> => {
  const project = useProject((s) => s.settings?.ignoredProblems ?? NONE);
  const repo = useProject((s) => s.settings?.repoPath ?? "");
  const mine = usePersonalIgnores((s) => s.byProject[repo] ?? NONE);
  return useMemo(
    () =>
      new Map<string, IgnoredBy>([
        ...mine.map((id): [string, IgnoredBy] => [id, "me"]),
        ...project.map((id): [string, IgnoredBy] => [id, "project"]),
      ]),
    [mine, project]
  );
};

/** The problems to fix: every one but those left as they are. */
export const useProblems = (): readonly Problem[] => {
  const all = useAllProblems();
  const ignored = useIgnoredBy();
  return useMemo(
    () => (ignored.size === 0 ? all : all.filter((p) => !ignored.has(p.id))),
    [all, ignored]
  );
};

/** The problems left as they are, and whose choice that was: what Settings lists. */
export const useIgnoredProblems = (): readonly {
  readonly by: IgnoredBy;
  readonly problem: Problem;
}[] => {
  const all = useAllProblems();
  const ignored = useIgnoredBy();
  return useMemo(
    () =>
      all.flatMap((problem) => {
        const by = ignored.get(problem.id);
        return by ? [{ by, problem }] : [];
      }),
    [all, ignored]
  );
};

/** Every problem's id now, the ones left included: what `setIgnored` keeps ids of. */
export const useProblemIds = (): ReadonlySet<string> => {
  const all = useAllProblems();
  return useMemo(() => new Set(all.map((p) => p.id)), [all]);
};

/**
 * The ids kept, `id` added or taken out, less those of problems gone: a list that names only
 * what is still there, so a problem fixed and back later is listed again.
 */
const keptIds = (
  ids: readonly string[],
  id: string,
  add: boolean,
  present: ReadonlySet<string>
) => [
  ...ids.filter((kept) => kept !== id && present.has(kept)),
  ...(add ? [id] : []),
];

/**
 * Leaves a problem as it is, or lists it again (`add` false), for the person or the project.
 * `present` is every problem's id now. The project's choice is a change of its settings, saved.
 */
export const setIgnored = async (
  id: string,
  by: IgnoredBy,
  add: boolean,
  present: ReadonlySet<string>
) => {
  const { settings } = useProject.getState();
  if (!settings) {
    return;
  }
  if (by === "me") {
    const repo = settings.repoPath;
    const ids = keptIds(
      usePersonalIgnores.getState().byProject[repo] ?? NONE,
      id,
      add,
      present
    );
    usePersonalIgnores.getState().set(repo, ids);
    await api()
      .request("profile.set", { preferences: { [IGNORED_PREFIX + repo]: ids } })
      .catch(reportError);
    return;
  }
  // In turn with every other save of the settings, on what the one before it saved: two
  // ignored in a row, or one beside a change in the dialog, are all kept.
  try {
    const problems = await saveWith((now) =>
      now
        ? {
            ...now,
            ignoredProblems: keptIds(
              now.ignoredProblems ?? NONE,
              id,
              add,
              present
            ),
          }
        : null
    );
    if (problems.length > 0) {
      reportError(problems.join(" "));
    }
  } catch (error) {
    reportError(error);
  }
};
