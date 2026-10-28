/**
 * The tasks of the sync (ADR 0025): what the code has that the design system does not list
 * described in it, Figma's or DESIGN.md's tokens matched to the design system's (ADR 0027), the
 * code brought up to the design (ADR 0028), or, with none of these, where the editor's sync
 * stands.
 */
import {
  baselineKey,
  type TokenDiff,
  type TokenSourceKind,
} from "@ultrapaint/contracts/sync";
import type { SyncTask } from "@ultrapaint/contracts/tasks";
import { SECTIONS } from "@ultrapaint/design-md/format";
import { mirrorOf } from "@ultrapaint/design-md/mirror";
import { parse } from "@ultrapaint/design-md/parse";
import { groupsOf } from "@ultrapaint/design-md/tokens";
import { Effect } from "effect";
import { ProjectManager } from "../../project.ts";
import { CodeSide } from "../code-side.ts";
import { DesignSystemService } from "../design-system.ts";
import { DesignSystemSyncService } from "../design-system-sync.ts";
import { RepoPaths } from "../repo-paths.ts";
import { targetTokens } from "../sync-sides.ts";
import type { AgentWays } from "./agent-ways.ts";
import {
  DESIGN_MD_GUIDE,
  needsTools,
  taskFailure,
  userAdds,
} from "./task-text.ts";

const COMMAND = "sync";

/** What the user is told when there is no design system yet to sync. */
const NO_DESIGN_SYSTEM =
  "Tell them to open the Design system panel and press Sync, which starts one, and stop.";

/** Tokens of each side a `/sync figma` task lists. */
const FIGMA_LISTED = 300;

export const makeSyncTasks = Effect.fnUntraced(function* (deps: {
  readonly ways: AgentWays;
}) {
  const { ways } = deps;
  const project = yield* ProjectManager;
  const sync = yield* DesignSystemSyncService;

  /** `/sync describe`: the tokens and components of the code the design system does not list, described in it. */
  const syncDescribe = (extra: string | undefined) =>
    Effect.gen(function* () {
      const plan = yield* sync.plan;
      const { drift } = plan;
      const { byName, designsDir } = yield* project.use(
        Effect.gen(function* () {
          const code = yield* (yield* CodeSide).tokens;
          return {
            byName: code.byName,
            designsDir: (yield* RepoPaths).settings.designsDir,
          };
        })
      );
      const declaredValue = (name: string) => byName.get(name)?.value ?? "";
      const list = (title: string, items: readonly string[]) =>
        items.length > 0
          ? `${title}\n${items.map((i) => `- ${i}`).join("\n")}\n`
          : "";
      if (!plan.facts.designSystem) {
        return yield* taskFailure(
          COMMAND,
          "there is no design system yet to describe the code in",
          NO_DESIGN_SYSTEM
        );
      }
      const doc = plan.facts.designMd;
      const prose =
        doc && !doc.legacy && doc.unwritten > 0
          ? `${doc.path} has ${doc.unwritten === SECTIONS.length ? "none of the format's sections written yet" : `${doc.unwritten} of the format's sections with nothing under them`}.`
          : "";
      const nothing =
        drift.tokensUndescribed.length +
          drift.tokensGone.length +
          drift.componentsUndescribed.length +
          drift.componentsGone.length ===
          0 && prose === "";
      return `<ultrapaint-task command="sync">
Describe in the design system what the code has that it does not list yet. The design system
holds the values (ADR 0028) and the code follows it; a token the code declares that the design
system does not list is taken with the code's value, and what each token and component is for is
yours to write, here and in DESIGN.md's prose.
${nothing ? "\nThe design system already lists every token and component of the code, and DESIGN.md's sections are written: say so, and stop.\n" : ""}
${list(
  "Tokens the code declares that the design system does not list:",
  drift.tokensUndescribed.map((n) => `${n}: ${declaredValue(n)}`)
)}${list(
  "Tokens the design system lists that the code no longer declares:",
  drift.tokensGone
)}${list(
  "Components of the code it says nothing about:",
  drift.componentsUndescribed
)}${list("Components it notes that the code no longer has:", drift.componentsGone)}${prose ? `\n${prose}\n` : ""}
1. Read the design system and DESIGN.md: ${ways.readDesignSystem(designsDir)}.
2. Each new token: find where the code uses it, put it in the group it belongs to and say in
   \`description\` what it is for. A token the product has on purpose but designers should not
   reach for goes into \`omitted\` instead.
3. Do not take a token out because the code does not declare it: the code is behind, and Sync
   exports it.
4. Each new component: ${ways.readComponent} for its props; give it a \`category\`, a \`description\` and
   \`exampleProps\` that make it render something meaningful. Take out the notes of a component gone.
5. DESIGN.md: say in its prose what changed above, and write what it does not say yet. Prose that
   is not in the format's sections is put in them, keeping what it says; a section the format does
   not know stays, after the others. ${DESIGN_MD_GUIDE}
6. Where what something is for is the user's to say, ask the user ${ways.askUser}, a few at
   a time.
7. ${ways.saveDesignSystem(designsDir)}
8. End with a short summary of what changed.
${userAdds(extra)}</ultrapaint-task>`;
    });

  /** A source's tokens, a line each: where it is (kind, value by theme) → what it is now. */
  const sourceLines = (diffs: readonly TokenDiff[]) => {
    const byVariable = new Map<string, TokenDiff[]>();
    for (const d of diffs) {
      byVariable.set(d.variable, [...(byVariable.get(d.variable) ?? []), d]);
    }
    const lines = [...byVariable.values()].flatMap((list) => {
      const [first] = list;
      if (!first) {
        return [];
      }
      const values = list
        .map((d) => (d.theme ? `${d.theme} ${d.source}` : d.source))
        .join("; ");
      const points = first.alias ? `, points at ${first.alias}` : "";
      let now = "unmatched";
      if (first.outcome === "ignored") {
        now = `left out (${first.by})`;
      } else if (first.outcome !== "unmatched") {
        now = `${first.name} (${first.by})`;
      }
      return [
        `- ${first.variable} (${first.kind}, ${values}${points}) → ${now}`,
      ];
    });
    const unmatched = [...byVariable.values()].filter(
      (list) => list[0]?.outcome === "unmatched"
    ).length;
    return { lines, unmatched };
  };

  /** The tokens a source is matched to, as Sync compares it (`sync-sides.ts`). */
  const targets = project.use(targetTokens);

  const listed = (lines: readonly string[]) =>
    lines.length > FIGMA_LISTED
      ? `${lines.slice(0, FIGMA_LISTED).join("\n")}\n- and ${lines.length - FIGMA_LISTED} more, for a second run`
      : lines.join("\n") || "- none";

  /** Why a source's tokens cannot be matched here. */
  const unavailable = (source: TokenSourceKind, why: "mcp" | "none") => {
    if (why === "mcp") {
      return needsTools(
        COMMAND,
        `matching ${source === "figma" ? "Figma's" : "DESIGN.md's"} tokens`,
        "Tell the user to start it with MCP on, or to match the tokens in the Design system panel's Sync view, and stop."
      );
    }
    return source === "figma"
      ? taskFailure(
          COMMAND,
          "no Figma file has been imported",
          "Tell them to import one from the Design system panel's Sync view, and stop."
        )
      : taskFailure(
          COMMAND,
          "there is no DESIGN.md at the root of the repository beside a design system",
          "Tell them to open the Design system panel's Sync view, which moves or writes it, and stop."
        );
  };

  /**
   * `/sync figma`: an agent matches the newest Figma import's tokens to the design system's (the
   * code's while there is none), with the user, before anything of Figma's is written (ADR
   * 0025). Both lists come in the task.
   */
  const syncFigma = (extra: string | undefined) =>
    Effect.gen(function* () {
      const { tools } = ways;
      if (!tools) {
        return yield* unavailable("figma", "mcp");
      }
      const comparison = yield* sync.tokens("figma");
      if (!comparison) {
        return yield* unavailable("figma", "none");
      }
      const { lines, unmatched } = sourceLines(comparison.diffs);
      const targetLines = (yield* targets).map(
        (t) => `- ${t.name}: ${t.value}`
      );
      return `<ultrapaint-task command="sync">
Match the tokens of the Figma file ${comparison.file} to the design system's (the code's while there
is no design system yet). A Figma file's names are rarely the ones the product wants
(\`Collection 1/Brand/600\`), and its palette is often more than the application uses: nothing of
Figma's is taken until it is matched, and the design system's names win. ${unmatched === 0 ? "Every token is matched already: check the matches, change what is wrong, and stop there." : `${unmatched} are not matched yet.`}

The tokens to match to:
${listed(targetLines)}

Figma's tokens, where each is in Figma (kind, value by theme) → what it is matched to now:
${listed(lines)}

1. Decide what each unmatched token is, and check what the rules matched:
   - a token listed above, when it is the same thing (the same role, not only the same value);
   - a new token, named the way the tokens above are named, not after Figma's collections:
 \`color-destructive\`, not \`color-collection-1-danger-danger\`;
   - left out, for what the application does not use: a palette step only other variables point
 at, a variable only Figma needs.
   Look at how the components use the tokens in the code when a name or a role is unclear.
2. Ask the user ${ways.askUser} where the meaning is theirs to say, a group at a time (the brand
   scale, the greys, the semantic colours), with your proposal as the first option.
3. Record the decisions with ${tools.map_values}: kind "figma", value the Figma variable as listed above,
   target the token it is, or keep: true to leave it out.
4. Do not write the stylesheets or the design system's values. Finish by telling the user to review
   the matches in the Design system panel's Sync view and to press Write there.
${userAdds(extra)}</ultrapaint-task>`;
    });

  /**
   * `/sync design`: an agent matches DESIGN.md's tokens to the design system's with the user,
   * and settles the text styles, which rules cannot (ADR 0027). Every list comes in the task.
   */
  const syncDesign = (extra: string | undefined) =>
    Effect.gen(function* () {
      const { tools } = ways;
      if (!tools) {
        return yield* unavailable("designMd", "mcp");
      }
      const comparison = yield* sync.tokens("designMd");
      if (!comparison) {
        return yield* unavailable("designMd", "none");
      }
      const { lines, unmatched } = sourceLines(comparison.diffs);
      const targetLines = (yield* targets).map(
        (t) => `- ${t.name}: ${t.value}`
      );
      const styles = yield* project.use(
        Effect.gen(function* () {
          const state = yield* (yield* DesignSystemService).get;
          const doc = state.document
            ? groupsOf(parse(state.document.text)).groups.typography
            : {};
          const ours = state.designSystem
            ? mirrorOf(state.designSystem).groups.typography
            : {};
          return { doc, ours };
        })
      );
      const styleLines = (byKey: Readonly<Record<string, object>>) =>
        Object.entries(byKey).map(
          ([key, settings]) =>
            `- ${key}: ${Object.entries(settings)
              .map(([field, value]) => `${field} ${String(value)}`)
              .join(", ")}`
        );
      const differ = Object.entries(styles.doc).filter(
        ([key, settings]) =>
          JSON.stringify(settings) !== JSON.stringify(styles.ours[key])
      );
      return `<ultrapaint-task command="sync">
Bring ${comparison.file}'s tokens into the design system. DESIGN.md is the design system in the open
format: its front matter mirrors the design system's tokens, and someone changed it by hand, or it
came from elsewhere (Stitch, a designer) with names of its own (\`tertiary\`,
\`surface-container-high\`). Nothing of it is taken until it is matched, and then the design
system's names win and the document is rewritten in them. ${unmatched === 0 ? "Every colour, radius and spacing is matched already: check the matches, then the text styles." : `${unmatched} of its tokens are not matched yet.`}

The design system's tokens:
${listed(targetLines)}

The document's tokens, where each is (kind, value) → what it is in the design system now:
${listed(lines)}

Its text styles${differ.length > 0 ? `, ${differ.length} of them different from the design system's` : ", the same as the design system's"}:
${listed(styleLines(styles.doc))}

The design system's text styles, as the document would write them:
${listed(styleLines(styles.ours))}

1. Match each unmatched token: a token of the design system when it is the same thing (the same
   role, not only the same value), a new token named the way it names its tokens, or left out.
   Read the document's prose: it says what each colour is for.
2. Ask the user ${ways.askUser} where the meaning is theirs to say, a group at a time, with your
   proposal as the first option.
3. Record the decisions with ${tools.map_values}: kind "design", value the token's place as listed above
   (\`colors.tertiary\`), target the design system's token, or keep: true to leave it out.
4. The text styles are several tokens each, so they are yours to settle with the user: a style of
   the document becomes a text style of design-system.json named so its key comes out the same
   (\`headline-lg\` is "Headline lg"), set in its tokens; where it needs a size, weight or line
   height the design system does not have, add the token to it. Save with ${tools.write_design_system},
   passing the design system and the whole of DESIGN.md as it is.
5. Do not write the colours, radii or spacing yourself. Finish by telling the
   user to review the matches in the Design system panel's Sync view and to press Write there.
${userAdds(extra)}</ultrapaint-task>`;
    });

  /** A token of the code comparison, a line: its name and theme, the code's value → the design's. */
  const codeLine = (d: TokenDiff) =>
    `- ${baselineKey(d.name, d.theme)}: code ${d.source ?? "(not declared)"}, design ${d.design ?? "(taken out)"}${d.base === undefined ? "" : `, agreed last ${d.base}`}`;

  /** `/sync code`'s numbered steps, for what the comparison has waiting on each side. */
  const codeSteps = (waiting: {
    readonly conflicts: number;
    readonly toCode: number;
    readonly toDesign: number;
  }) => {
    const first =
      waiting.toCode > 0
        ? `Export what waits for the code: ${ways.exportTokens("all")}.`
        : "Nothing waits for the code.";
    const second =
      waiting.toDesign > 0
        ? `What the code changed alone is usually a fix someone made in the code: ask the user ${ways.askUser}\n   whether to keep it (the design takes it) or put the design's value back, a group at a time.\n   For those kept, ${ways.importTokens("named")}; for those put back, ${ways.exportTokens("named")}.`
        : "Nothing changed in the code alone.";
    const third =
      waiting.conflicts > 0
        ? `For each token changed on both sides, ask the user which value to keep, with the design's\n   as the first option, then ${ways.settleTokens}.`
        : "Nothing changed on both sides.";
    return `1. ${first}
2. ${second}
3. ${third}
4. End with a short summary: what was written where, and what the user left as it is.`;
  };

  /**
   * `/sync code` (ADR 0028): the code brought up to the design, what the code changed alone
   * offered to the design, and the conflicts settled with the user. The lists come in the task;
   * the values are written through handoff, which the Sync view's buttons also come to.
   */
  const syncCode = (extra: string | undefined) =>
    Effect.gen(function* () {
      const comparison = yield* sync.tokens("code").pipe(
        // Nothing open, or the stylesheets not read: the task says there is nothing to compare.
        Effect.orElseSucceed(() => null)
      );
      if (!comparison) {
        return yield* taskFailure(
          COMMAND,
          "there is no design system yet to bring the code up to",
          NO_DESIGN_SYSTEM
        );
      }
      const by = (outcome: TokenDiff["outcome"]) =>
        comparison.diffs.filter((d) => d.outcome === outcome);
      const toCode = by("source-behind");
      const toDesign = by("to-design");
      const conflicts = by("conflict");
      if (toCode.length + toDesign.length + conflicts.length === 0) {
        return `<ultrapaint-task command="sync">
The user ran /sync code. The code has every value of the design: say so, and stop.
</ultrapaint-task>`;
      }
      const list = (title: string, diffs: readonly TokenDiff[]) =>
        diffs.length > 0 ? `${title}\n${listed(diffs.map(codeLine))}\n` : "";
      const where =
        comparison.file === "the code"
          ? ""
          : `The code's tokens are in ${comparison.file}. `;
      const notes =
        comparison.notes.length > 0
          ? `\nWhat could not be read: ${comparison.notes.join(" ")}\n`
          : "";
      return `<ultrapaint-task command="sync">
Bring the code up to the design (ADR 0028). The design system holds every token's value and the
stylesheets follow it: a token changed in the design alone waits for the code, one changed in the
code alone is offered to the design, and where both changed since they last agreed the user
picks. ${where}Do not edit design-system.json, design.tokens.json or the stylesheets' tokens by hand.

${list("Tokens of the design that wait for the code:", toCode)}${list("Tokens changed in the code alone:", toDesign)}${list("Tokens changed on both sides:", conflicts)}${notes}
${codeSteps({ conflicts: conflicts.length, toCode: toCode.length, toDesign: toDesign.length })}
${userAdds(extra)}</ultrapaint-task>`;
    });

  /** Where the editor's sync stands, when no source is named: its steps are the user's. */
  const overview = Effect.map(
    sync.plan,
    (plan) => `<ultrapaint-task command="sync">
The user ran /sync. The sync is the editor's: its steps are in the Design system panel, where the
user starts each one. Where it stands: ${plan.summary}
Its steps: ${plan.steps.map((s) => `${s.title} (${s.state})`).join("; ")}.
Tell the user, in a sentence or two, what the next step is and that they start it from the panel;
do not do the steps yourself, and stop.
</ultrapaint-task>`
  );

  const syncTask = Effect.fnUntraced(function* ({ extra, source }: SyncTask) {
    switch (source) {
      case "code":
        return yield* syncCode(extra);
      case "describe":
        return yield* syncDescribe(extra);
      case "figma":
        return yield* syncFigma(extra);
      case "design":
        return yield* syncDesign(extra);
      default:
        return yield* overview;
    }
  });

  return { sync: syncTask };
});
