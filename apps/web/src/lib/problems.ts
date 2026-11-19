/**
 * Problems (ADR 0106), worked out from what the editor reads: what the design system's files and the sync say needs fixing, in one list
 * the rail opens in either mode. DESIGN.md's linter (`@google/design.md`) speaks for its own
 * tools, so its findings are said again here in Ultrapaint's words, each with what it costs and
 * the raw message kept for the agent asked to fix it. Information is not a problem; a waiting sync
 * step is, and the Sync is where it is answered.
 */
import type {
  DesignDocument,
  DesignFinding,
} from "@ultrapaint/contracts/design-system";
import type { SyncPlan, SyncStep } from "@ultrapaint/contracts/sync";

/** Where a problem is read from: the group it is listed in. */
export type ProblemSource =
  | "Sync"
  | "DESIGN.md"
  | "design-system.json"
  | "design.tokens.json";

export interface Problem {
  /** What the agent asked to fix it is told: the file's own words, where it says. */
  readonly brief: string;
  /** What it costs, or how to fix it; none when the title says it all. */
  readonly detail: string | null;
  /**
   * Where it is written, for Show in file: the file (repository-relative) and the path of keys
   * to its line, when it has one. None for a sync step, which lives in no file.
   */
  readonly file: { readonly at: string | null; readonly path: string } | null;
  /** `sync`: answered in the Sync. `agent`: a chat drafted to fix it. */
  readonly fix: "agent" | "sync";
  /**
   * A stable name for it, whose words are the file's: a problem whose words change (a contrast
   * that moved) is a new one, and an ignored one comes back.
   */
  readonly id: string;
  readonly severity: "error" | "warning";
  readonly source: ProblemSource;
  /** What is wrong, in a few words; a token's name between backticks, set in code. */
  readonly title: string;
}

/** The order the groups are listed in: the sync first, as it is answered there and not here. */
const SOURCES: readonly ProblemSource[] = [
  "Sync",
  "design-system.json",
  "design.tokens.json",
  "DESIGN.md",
];

/** The steps that wait for the person: Problems lists them under Sync (ADR 0106). */
export const waitingSteps = (plan: SyncPlan | null): readonly SyncStep[] =>
  plan?.steps.filter(
    (s) =>
      s.state === "attention" &&
      (s.kind === "settings" ||
        s.kind === "describe" ||
        s.kind === "design-md" ||
        s.kind === "design-tokens" ||
        s.kind === "figma-tokens")
  ) ?? [];

/** A component's name from a path into DESIGN.md's front matter (`components.card.textColor`). */
const subjectOf = (path: string | undefined) => {
  if (!path) {
    return null;
  }
  const [head, name] = path.split(".");
  return head === "components" && name ? name : path;
};

const code = (text: string) => `\`${text}\``;

const ORPHANED = /^'([^']+)' is defined but never referenced by any component/;

interface Words {
  readonly detail: string | null;
  readonly title: string;
}

/**
 * The linter's messages it knows (`@google/design.md` 0.4's rules), each said again: what is
 * wrong, and what it costs or how to fix it. `subject` is the component or the place it names.
 */
const RULES: readonly {
  readonly pattern: RegExp;
  readonly words: (match: RegExpExecArray, subject: string | null) => Words;
}[] = [
  {
    pattern: /^No 'primary' color defined/,
    words: () => ({
      detail: `Agents can’t tell which colour marks an action. Name the one your buttons use ${code("primary")}.`,
      title: "No primary colour",
    }),
  },
  {
    pattern: /^No typography tokens defined/,
    words: () => ({
      detail:
        "Agents choose their own type until DESIGN.md has the product’s text styles.",
      title: "No text styles",
    }),
  },
  {
    pattern:
      /^textColor \((\S+)\) on backgroundColor \((\S+)\) has contrast ratio ([\d.]+):1, below WCAG AA minimum of ([\d.]+):1/,
    words: ([, , , ratio = "", needed = ""], subject) => ({
      detail: `Its text is ${Number(ratio).toFixed(1)}:1 on its fill; text needs ${needed}:1.`,
      title: `${code(subject ?? "A component")} is hard to read`,
    }),
  },
  {
    pattern: /^Reference (\{[^}]+\}) does not resolve/,
    words: ([, reference = ""], subject) => ({
      detail: `${code(reference)} isn’t defined.`,
      title: `${code(subject ?? "A token")} points to a missing token`,
    }),
  },
  {
    pattern:
      /^'([^']+)' is not a recognized component sub-token\. Valid sub-tokens: (.+)\.$/,
    words: ([, property = "", valid = ""], subject) => ({
      detail: `A component takes ${valid}.`,
      title: `${code(subject ?? "A component")} has an unknown property, ${code(property)}`,
    }),
  },
  {
    pattern:
      /^Section '([^']+)' appears before '([^']+)', which is out of order/,
    words: ([, first = "", second = ""]) => ({
      detail: `${first} comes before ${second}. Agents read the sections in the format’s order.`,
      title: "Sections out of order",
    }),
  },
  {
    pattern: /^Unknown key "([^"]+)" — did you mean "([^"]+)"\?/,
    words: ([, key = "", meant = ""]) => ({
      detail: `Did you mean ${code(meant)}?`,
      title: `${code(key)} isn’t a key DESIGN.md knows`,
    }),
  },
  {
    pattern: /^"([^"]+)" looks like a design-token map/,
    words: ([, key = ""]) => ({
      detail:
        "It looks like tokens, but agents read only colors, typography, spacing, rounded and components.",
      title: `${code(key)} is ignored`,
    }),
  },
  {
    pattern: /^'([^']+)' is not a valid color/,
    words: ([, value = ""], subject) => ({
      detail: `${code(value)} isn’t a CSS colour, such as #ffffff or oklch(0.5 0.2 240).`,
      title: `${code(subject ?? "A colour")} isn’t a colour`,
    }),
  },
];

/** A finding of DESIGN.md's linter, in Ultrapaint's words: its title and what it costs. */
export const findingWords = (finding: DesignFinding): Words => {
  const { message, path } = finding;
  for (const rule of RULES) {
    const match: RegExpExecArray | null = rule.pattern.exec(message);
    if (match !== null) {
      return rule.words(match, subjectOf(path));
    }
  }
  // One it does not know: the linter's words, under the place it names.
  return path
    ? { detail: message, title: code(path) }
    : { detail: null, title: message };
};

/** The linter's finding as the agent is told it: where, and its own words. */
const briefOf = (file: string, finding: DesignFinding) =>
  `${file}${finding.path ? `, ${code(finding.path)}` : ""}: ${finding.message}`;

/**
 * Colours no component uses are one problem, not one each: a design system with many reads as a
 * wall of the same warning otherwise.
 */
const unusedColours = (
  file: string,
  findings: readonly DesignFinding[]
): Problem | null => {
  const names = findings.flatMap((f) => {
    const match: RegExpExecArray | null = ORPHANED.exec(f.message);
    return match?.[1] ? [match[1]] : [];
  });
  if (names.length === 0) {
    return null;
  }
  const one = names.length === 1;
  return {
    brief: `${file}: ${names.map(code).join(", ")} ${one ? "is" : "are"} defined but never referenced by any component.`,
    detail: `${names.map(code).join(", ")}. Use ${one ? "it" : "them"} in a component, or remove ${one ? "it" : "them"}.`,
    file: { at: `colors.${names[0]}`, path: file },
    fix: "agent",
    // The colours named: one more or one fewer is another problem, listed again if left.
    id: `DESIGN.md:unused-colours:${[...names].sort().join(",")}`,
    severity: "warning",
    source: "DESIGN.md",
    title: one
      ? "A colour no component uses"
      : `${names.length} colours no component uses`,
  };
};

const documentProblems = (document: DesignDocument | null): Problem[] => {
  if (!document) {
    return [];
  }
  const file = document.path;
  const shown = document.findings.filter((f) => f.severity !== "info");
  const listed: Problem[] = shown
    .filter((f) => !ORPHANED.test(f.message))
    .map((f) => ({
      ...findingWords(f),
      brief: briefOf(file, f),
      file: { at: f.path ?? null, path: file },
      fix: "agent",
      id: `DESIGN.md:${f.path ?? ""}:${f.message}`,
      severity: f.severity === "error" ? "error" : "warning",
      source: "DESIGN.md",
    }));
  const unused = unusedColours(file, shown);
  return unused ? [...listed, unused] : listed;
};

const NAMED = /^design(?:-system|\.tokens)\.json is (?:not valid: )?/;
const MEANWHILE =
  /: the values are design-system\.json's and the code's until it reads$/;

/** The server's reason a file does not read, without the file's name it starts with. */
export const reasonOf = (problem: string) =>
  problem
    .replace(NAMED, "")
    .replace(MEANWHILE, "")
    .replace("SyntaxError: ", "");

const ENDS_A_SENTENCE = /[.!?]$/;

/** A reason as a sentence: capitalised, ending in a full stop. */
const sentence = (text: string) => {
  const trimmed = text.trim();
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return ENDS_A_SENTENCE.test(capital) ? capital : `${capital}.`;
};

const TOKENS_PREFIX = "design.tokens.json: ";
/** The token a note names first, between backticks: where its line is. */
const QUOTED_TOKEN = /`([^`]+)`/;

export interface ProblemsInput {
  /** Whether `design-system.json` read: a `problem` is then the tokens file's. */
  readonly designSystemRead: boolean;
  /** The designs directory, repository-relative: where the design system's two files are. */
  readonly designsDir: string;
  readonly document: DesignDocument | null;
  readonly notes: readonly string[];
  readonly plan: SyncPlan | null;
  readonly problem: string | undefined;
}

/** Everything that needs fixing, grouped by where it is read from, in the order they are listed. */
export const problemsOf = (input: ProblemsInput): readonly Problem[] => {
  const all: Problem[] = [
    ...waitingSteps(input.plan).map(
      (step): Problem => ({
        brief: `${step.title}: ${step.detail}`,
        detail: step.detail,
        file: null,
        fix: "sync",
        id: `Sync:${step.kind}`,
        severity: "warning",
        source: "Sync",
        title: step.title,
      })
    ),
  ];
  if (input.problem !== undefined) {
    const file = input.designSystemRead
      ? "design.tokens.json"
      : "design-system.json";
    all.push({
      brief: `${file} doesn’t read: ${reasonOf(input.problem)}`,
      // Why it doesn't read, then what holds meanwhile: the person sees the cause without a chat.
      detail: `${sentence(reasonOf(input.problem))} ${
        input.designSystemRead
          ? "Its values are design-system.json’s and the code’s until it reads."
          : "Designs use Ultrapaint’s default look until it reads."
      }`,
      file: { at: null, path: `${input.designsDir}/${file}` },
      fix: "agent",
      id: `${file}:problem`,
      severity: "error",
      source: file,
      title: `${file} doesn’t read`,
    });
  }
  for (const note of input.notes) {
    const said = note.startsWith(TOKENS_PREFIX)
      ? note.slice(TOKENS_PREFIX.length)
      : note;
    const token: RegExpExecArray | null = QUOTED_TOKEN.exec(said);
    all.push({
      brief: note,
      detail: null,
      file: {
        at: token === null ? null : (token[1] ?? null),
        path: `${input.designsDir}/design.tokens.json`,
      },
      fix: "agent",
      id: `design.tokens.json:${note}`,
      severity: "warning",
      source: "design.tokens.json",
      title: said,
    });
  }
  all.push(...documentProblems(input.document));
  return all.sort(
    (a, b) => SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source)
  );
};

/**
 * Whether a problem can be left as it is: a warning an agent would fix. An error breaks what
 * agents read, and a sync step is answered in the Sync.
 */
export const ignorable = (problem: Problem) =>
  problem.severity === "warning" && problem.fix === "agent";

/** Whether any of them is an error: the rail's sign is red then, amber otherwise. */
export const worstOf = (problems: readonly Problem[]) =>
  problems.some((p) => p.severity === "error") ? "error" : "warning";

/**
 * What a chat is drafted with to fix `problems`: each as its file says it, for the agent; the
 * person reads it in the composer before sending, and a choice that is theirs is asked.
 */
export const fixPrompt = (problems: readonly Problem[]) => {
  const fixable = problems.filter((p) => p.fix === "agent");
  if (fixable.length === 1) {
    return `Fix this in the design system: ${fixable[0]?.brief} Ask me where the choice is mine.`;
  }
  return [
    "Fix these in the design system:",
    ...fixable.map((p) => `- ${p.brief}`),
    "Ask me where a choice is mine.",
  ].join("\n");
};
