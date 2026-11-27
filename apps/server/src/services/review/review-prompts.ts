/**
 * What the review loop says (ADR 0063): to a review model, its role, the skill's rules (ADR 0077),
 * the person's request and the pages as it is shown them; to the designer, a round's findings to fix or decline. How a
 * review judges is the skill's (its review job and `references/review.md`, ADR 0111), told as the
 * lab's `told` reviewers are told it (`toldRules`); the answer's shape is the lab's
 * (`evals/prompts/review-section.md`, `evals/src/section-review.ts`), so the editor and the lab
 * review a design alike.
 */
import type { ContentBlock } from "@ultrapaint/acp/acp-agent";
import {
  CATEGORIES,
  REVIEW_TABLE_FILE,
  toldRules,
} from "@ultrapaint/contracts/review";
import type { RoundFinding } from "@ultrapaint/contracts/threads";
import { coreText, skillFiles } from "../../skills/index.ts";
import type { PageChecks } from "./check-findings.ts";

/** A page as a review model is shown it. */
export interface PageView {
  /**
   * What the checks measured on it, for the designer: never shown to a review model (ADR 0081).
   * None when it wasn't read.
   */
  readonly checks?: PageChecks | undefined;
  /** Its design document, compact JSON. */
  readonly document: string;
  readonly file: string;
  /** What the canvas calls it (`Page.name`), as the checks' findings name it: the editor lists it. */
  readonly name?: string | undefined;
  /** Its picture as the editor draws it (PNG, base64), or why there is none. */
  readonly picture:
    | { readonly data: string; readonly kind: "png" }
    | { readonly kind: "none"; readonly why: string };
  readonly route?: string | undefined;
}

/**
 * The review role: a fresh designer that only looks, and the answer it gives. How it judges (what
 * first, the request's scope, one finding per problem, the severities and the sign-off) is the
 * skill's review job and `references/review.md`, told after it (ADR 0111): the role keeps what is
 * the editor's, its sandbox, its pages and its answer.
 */
export const REVIEWER_ROLE = `You review a design with Ultrapaint's design skill: you are a fresh designer seeing it for the first time. You only look. The repository is read-only to you and every file, terminal and permission you ask for is refused: read what you are given here, and change nothing. The designer makes the fixes.

Review it as the skill's review job below says, by its rules and its review: what to judge first, within the person's request and its scope, one finding per problem, each with its severity, and whether each page is done. The pages are often one screen in its states (empty, loading, an error): a problem they share is one finding, given on the first page that has it, its \`where\` naming the others.

Answer with one fenced \`\`\`json block, and nothing after it:

\`\`\`json
{ "pages": [ { "page": "<the page's file, as named below>", "findings": [ … ], "reached": [ … ], "signOff": { "done": false, "left": "…" } } ] }
\`\`\`

- \`findings\`, each with:
  - \`title\` (a few words), \`where\` (the element), \`problem\` (what is wrong, in one or two sentences) and \`fix\`;
  - \`category\`: the concern it falls under, one of ${CATEGORIES.map((c) => `\`${c}\``).join(", ")} (\`picture\` for how it keeps to a picture it was given);
  - \`severity\`: \`blocker\`, \`major\`, \`minor\` or \`nit\`, as the skill's review defines them;
  - \`rule\`: the skill's rule it breaks, as its file and the rule's words (\`references/states.md › every load has its error\`), or empty when the skill has no rule for it.
- \`reached\`: the categories the page has besides hierarchy, restraint, layout, spacing, typography and color (icons → \`iconography\`, words → \`content\`, a loading or empty state → \`states\`, …): what it is scored on.
- \`signOff\`: \`done\` true when the page is done for what the person asked, as the skill's review says, and then \`left\` is empty; else \`done\` false and \`left\` saying in a sentence what has to change first.`;

/**
 * The skill's rules, told to a review model after its role (ADR 0077): it opens no file, so what
 * it knows of the skill is what it is told, as the lab's `told` reviewers are.
 */
export const REVIEWER_RULES = toldRules(
  coreText,
  skillFiles[REVIEW_TABLE_FILE]
);

/** A page's name as the review says it. */
export const pageName = (page: {
  readonly file: string;
  readonly route?: string | undefined;
}) => (page.route === undefined ? page.file : `${page.route} (${page.file})`);

/**
 * The second look (ADR 0063): the findings the designer was sent, to say which are not fixed,
 * and nothing new but a blocker.
 */
const secondLook = (open: readonly RoundFinding[]): string =>
  `## This is a second look

${
  open.length > 0
    ? `The designer was sent these findings and has answered them:\n\n${open
        .map((f, i) => `${i + 1}. **${f.title}** (${f.where}): ${f.problem}`)
        .join(
          "\n"
        )}\n\nFor each, decide whether the design fixes it now. Give back as findings only those not fixed, with their title as written above, and any new blocker.`
    : "Another review model looked first and found nothing the designer had to fix. Give back only blockers."
} Judge it as the skill's review says of a second look. \`signOff.done\` is true when you give back nothing.`;

/** What a review model is given: its role, the request, and each page's picture and document. */
export const reviewerPrompt = (
  request: string,
  pages: readonly PageView[],
  /** On a second look, the findings it checks; absent on a first. */
  open?: readonly RoundFinding[]
): ContentBlock[] => [
  { text: REVIEWER_ROLE, type: "text" },
  { text: REVIEWER_RULES, type: "text" },
  {
    text: `## What the person asked\n\n<request>\n${request.trim() || "(nothing said)"}\n</request>`,
    type: "text",
  },
  ...pages.flatMap((page): ContentBlock[] => [
    {
      text: `## The page ${pageName(page)}\n\n${
        page.picture.kind === "png"
          ? "Its picture, as the editor draws it:"
          : `There is no picture of it: ${page.picture.why} Review it from its document.`
      }`,
      type: "text",
    },
    ...(page.picture.kind === "png"
      ? [
          {
            data: page.picture.data,
            mimeType: "image/png",
            type: "image" as const,
          },
        ]
      : []),
    {
      text: `Its design document (\`${page.file}\`):\n\n\`\`\`json\n${page.document}\n\`\`\``,
      type: "text",
    },
  ]),
  ...(open === undefined
    ? []
    : [{ text: secondLook(open), type: "text" as const }]),
];

/**
 * A round's findings, as the designer is asked to fix or decline each, with what the review
 * models still want of the pages where it isn't in a finding. The checks' findings come after the
 * reviewers', each marked as a check's (ADR 0081); with none of the reviewers', the review is over
 * and the checks' are all there is. A review model's finding it would decline while it leaves what
 * the finding says is wrong is put to the user first, on `questionTool`, and one the user kept is
 * written as theirs; a check's is never asked (ADR 0157).
 */
export const findingsPrompt = (
  pages: readonly {
    readonly file: string;
    readonly route?: string | undefined;
  }[],
  findings: readonly RoundFinding[],
  left: readonly string[],
  /** The question tool as the designer knows it (`AgentWays.questionTool`). */
  questionTool: string
) => {
  const listed = findings.map((f, i) =>
    f.check === undefined
      ? `${i + 1}. **${f.title}** (${f.where}; ${f.category}, ${f.severity}): ${f.problem} Fix: ${f.fix}`
      : `${i + 1}. **${f.title}** (${f.where}; a check's, ${f.category}): ${f.problem} Fix: ${f.fix}`
  );
  const named = pages.map(pageName).join(", ");
  const reviewed = findings.some((f) => f.check === undefined);
  const checked = findings.some((f) => f.check !== undefined);
  const one = pages.length === 1;
  return [
    reviewed || left.length > 0
      ? `The review models looked at ${named}.`
      : `The review of ${named} is over.`,
    ...(checked
      ? [
          `The checks measured ${one ? "it" : "them"}${reviewed ? " too" : ""}, ${one ? "on the page the editor drew and in its document" : "on the pages the editor drew and in their documents"}: their findings are marked as a check's, with what each measured. A check's finding is minor, and doesn't hold back approval.`,
        ]
      : []),
    ...(listed.length > 0
      ? [
          `Fix each finding below, or decline it when fixing it would go against what was asked${checked ? " or, for a check's, when the design means it" : ""}, with your reason.`,
          listed.join("\n"),
        ]
      : []),
    ...(reviewed
      ? [
          `A review model's finding you would decline is the user's to decide when declining it leaves on the page what the finding says is wrong. Before you end your reply, ask them with ${questionTool}, one question per finding, the worst first and at most four a call: your call first, as "Keep it as it is: <your reason>", then the fix. Fix what they choose to fix, or do what they wrote instead. Decline without asking only what changes nothing they see: a finding the design already meets, or one about something the request ruled out in its own words.${checked ? " A check's finding is never asked: decline it yourself." : ""}`,
        ]
      : []),
    ...(left.length > 0
      ? [
          `They haven't approved it yet:\n${left.map((l) => `- ${l}`).join("\n")}`,
        ]
      : []),
    ...(listed.length > 0
      ? [
          `End your reply with one line for each finding you declined, by its number, and none for those you fixed:\nDeclined: <the finding's number> — <your reason>${
            reviewed
              ? `\nDeclined by the user: <the finding's number> — <the reason>\nThe second for a decline the user kept when you asked. One they didn't answer, or that you couldn't wait on, is the first, and your reply says they haven't answered.`
              : ""
          }`,
        ]
      : []),
  ].join("\n\n");
};
