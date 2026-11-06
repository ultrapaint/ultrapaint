/**
 * What the review loop says (ADR 0063): to a review model, its role, the person's request and the
 * pages as it is shown them; to the designer, a round's findings to fix or decline. The wording
 * and the answer's shape are the lab's (`evals/prompts/review-section.md`,
 * `evals/src/section-review.ts`), so the editor and the lab review a design alike.
 */
import type { ContentBlock } from "@ultrapaint/acp/acp-agent";
import { CATEGORIES } from "@ultrapaint/contracts/review";
import type { RoundFinding } from "@ultrapaint/contracts/threads";

/** A page as a review model is shown it. */
export interface PageView {
  /** Its design document, compact JSON. */
  readonly document: string;
  readonly file: string;
  /** Its picture as the editor draws it (PNG, base64), or why there is none. */
  readonly picture:
    | { readonly data: string; readonly kind: "png" }
    | { readonly kind: "none"; readonly why: string };
  readonly route?: string | undefined;
}

/** The review role: a fresh designer that only looks, and the answer it gives. */
export const REVIEWER_ROLE = `You review a design with Ultrapaint's design skill: you are a fresh designer seeing it for the first time. You only look. The repository is read-only to you and every file, terminal and permission you ask for is refused: read what you are given here, and change nothing. The designer makes the fixes.

Review what takes judgement, which a check can't: the hierarchy (what is seen first, second, third), restraint (what could go), its character (whether it looks made for this product rather than any), the states it needs (empty, loading, error, long content) and its content (words that say what the person gets, in their language). Then the rest a careful designer would fix: layout, spacing, typography, colour, elevation, borders, iconography, motion, components, usability, accessibility, and how it keeps to a picture it was given.

Review within the person's request below: its content is used as written (a word, a label or a line of copy it gives is not a finding), a picture it gave decides the look, and the components (a dialog, tabs, a switch, an input, a button) are the design system's: how one draws itself is the system's. Report only what the designer can change within this request.

List every problem in each page that a careful designer would fix: one finding per problem, each with what is wrong, where, which rule it breaks and the fix. Leave out what is fine.

Answer with one fenced \`\`\`json block, and nothing after it:

\`\`\`json
{ "pages": [ { "page": "<the page's file, as named below>", "findings": [ … ], "reached": [ … ], "signOff": { "done": false, "left": "…" } } ] }
\`\`\`

- \`findings\`, each with:
  - \`title\` (a few words), \`where\` (the element), \`problem\` (what is wrong, in one or two sentences) and \`fix\`;
  - \`category\`: the skill's reference it falls under, one of ${CATEGORIES.map((c) => `\`${c}\``).join(", ")} (\`picture\` for how it keeps to a picture it was given);
  - \`severity\`: \`blocker\` (it fails at its job: unreadable, can't be used, broken), \`major\` (a careful designer wouldn't ship it), \`minor\` (noticeable, worth fixing) or \`nit\` (polish);
  - \`rule\`: the skill's rule it breaks, as its reference and the rule's words (\`references/states.md › every load has its error\`), or empty when the skill has no rule for it.
- \`reached\`: the categories the page has besides hierarchy, restraint, layout, spacing, typography and color (icons → \`iconography\`, words → \`content\`, a loading or empty state → \`states\`, …): what it is scored on.
- \`signOff\`: \`done\` true when, for what the person asked, the page is good enough as it stands, with \`left\` empty; else \`done\` false and \`left\` saying in a sentence what has to change first. Hold a product screen to a high bar, and a quick sketch the request asks for to a lower one.`;

/** A page's name as the review says it. */
export const pageName = (page: {
  readonly file: string;
  readonly route?: string | undefined;
}) => (page.route === undefined ? page.file : `${page.route} (${page.file})`);

/** What a review model is given: its role, the request, and each page's picture and document. */
export const reviewerPrompt = (
  request: string,
  pages: readonly PageView[]
): ContentBlock[] => [
  { text: REVIEWER_ROLE, type: "text" },
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
];

/**
 * A round's findings, as the designer is asked to fix or decline each, with what the review
 * models still want of the pages where it isn't in a finding.
 */
export const findingsPrompt = (
  pages: readonly {
    readonly file: string;
    readonly route?: string | undefined;
  }[],
  findings: readonly RoundFinding[],
  left: readonly string[]
) => {
  const listed = findings.map(
    (f, i) =>
      `${i + 1}. **${f.title}** (${f.where}; ${f.category}, ${f.severity}): ${f.problem} Fix: ${f.fix}`
  );
  return [
    `The review models looked at ${pages.map(pageName).join(", ")}.`,
    ...(listed.length > 0
      ? [
          "Fix each finding below, or decline it when fixing it would go against what was asked, with your reason.",
          listed.join("\n"),
        ]
      : []),
    ...(left.length > 0
      ? [
          `They haven't approved it yet:\n${left.map((l) => `- ${l}`).join("\n")}`,
        ]
      : []),
    ...(listed.length > 0
      ? [
          "End your reply with one line for each finding you declined, and none for those you fixed:\nDeclined: <the finding's title> — <your reason>",
        ]
      : []),
  ].join("\n\n");
};
