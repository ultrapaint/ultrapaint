/**
 * The tasks of `/sync` (ADR 0025): the design system described up to the code, Figma's tokens
 * matched to the code's, or, with neither, where the editor's sync stands.
 */
import type { FigmaTokenDiff } from "@ultrapaint/contracts/sync";
import { Effect } from "effect";
import { ServerConfig } from "../../config.ts";
import { ProjectManager } from "../../project.ts";
import { DesignSystemSyncService } from "../design-system-sync.ts";
import { RepoPaths } from "../repo-paths.ts";
import { ProjectStyleSystem } from "../style-system.ts";
import { splitArgument, userAdds } from "./task-text.ts";

/** Tokens of each side a `/sync figma` task lists. */
const FIGMA_LISTED = 300;

export const makeSyncTasks = Effect.gen(function* () {
  const project = yield* ProjectManager;
  const sync = yield* DesignSystemSyncService;
  const { mcp } = yield* ServerConfig;

  /** `/sync describe`: the design system brought up to the code's tokens and components. */
  const syncDescribe = (extra: string) =>
    Effect.gen(function* () {
      const plan = yield* sync.plan;
      const { drift } = plan;
      const tokens = yield* project.use(
        Effect.gen(function* () {
          const paths = yield* RepoPaths;
          return (yield* ProjectStyleSystem).readTokens({
            anchorDir: paths.anchorDir,
            root: paths.root,
            settings: paths.settings,
          }).tokens;
        })
      );
      const declaredValue = (name: string) =>
        tokens.find((t) => t.name === name)?.value ?? "";
      const list = (title: string, items: readonly string[]) =>
        items.length > 0
          ? `${title}\n${items.map((i) => `- ${i}`).join("\n")}\n`
          : "";
      if (!plan.facts.designSystem) {
        return `<ultrapaint-task command="sync">
The user ran /sync describe, but there is no design system yet to describe the code in. Tell them
to open the Design system panel and press Sync, which starts one, and stop.
</ultrapaint-task>`;
      }
      const nothing =
        drift.tokensUndescribed.length +
          drift.tokensGone.length +
          drift.componentsUndescribed.length +
          drift.componentsGone.length ===
        0;
      return `<ultrapaint-task command="sync">
Bring the design system up to the code as it is now. Its values are the code's: they are read from
the code every time, so only what each token and component is for is yours to write.
${nothing ? "\nThe design system already lists every token and component of the code: say so, and stop.\n" : ""}
${list(
  "Tokens the code declares that the design system does not list:",
  drift.tokensUndescribed.map((n) => `${n}: ${declaredValue(n)}`)
)}${list(
  "Tokens the design system lists that the code no longer declares:",
  drift.tokensGone
)}${list(
  "Components of the code it says nothing about:",
  drift.componentsUndescribed
)}${list("Components it notes that the code no longer has:", drift.componentsGone)}
1. read_design_system for the design system and DESIGN.md.
2. Each new token: find where the code uses it, put it in the group it belongs to and say in
   \`description\` what it is for. A token the product has on purpose but designers should not
   reach for goes into \`omitted\` instead.
3. Each token gone: take it out. If pages still use it (read_page), tell the user which, and ask
   whether the code should declare it again.
4. Each new component: get_component for its props; give it a \`category\`, a \`description\` and
   \`exampleProps\` that make it render something meaningful. Take out the notes of a component gone.
5. Where what something is for is the user's to say, ask with ask_user, a few at a time.
6. Save with write_design_system; then a short summary of what changed.
${userAdds(extra)}</ultrapaint-task>`;
    });

  /**
   * `/sync figma`: an agent matches the newest Figma import's tokens to the code's, with the
   * user, before anything of Figma's is written (ADR 0025). Both lists come in the task.
   */
  const syncFigma = (extra: string) =>
    Effect.gen(function* () {
      if (!mcp) {
        return `<ultrapaint-task command="sync">
The user ran /sync figma, which matches Figma's tokens through the editor's MCP server, and the
server was started without it. Tell the user to start it with MCP on, or to match the tokens in the
Design system panel's Sync view, and stop.
</ultrapaint-task>`;
      }
      const comparison = yield* sync.figmaTokens;
      if (!comparison) {
        return `<ultrapaint-task command="sync">
The user ran /sync figma, but no Figma file has been imported. Tell them to import one from the
Design system panel's Sync view, and stop.
</ultrapaint-task>`;
      }
      const byVariable = new Map<string, FigmaTokenDiff[]>();
      for (const d of comparison.diffs) {
        byVariable.set(d.variable, [...(byVariable.get(d.variable) ?? []), d]);
      }
      const figmaLines = [...byVariable.values()].flatMap((diffs) => {
        const [first] = diffs;
        if (!first) {
          return [];
        }
        const values = diffs
          .map((d) => (d.theme ? `${d.theme} ${d.figma}` : d.figma))
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
      const code = yield* project.use(
        Effect.gen(function* () {
          const paths = yield* RepoPaths;
          return (yield* ProjectStyleSystem)
            .readTokens({
              anchorDir: paths.anchorDir,
              root: paths.root,
              settings: paths.settings,
            })
            .tokens.filter((t) => t.own);
        })
      );
      const codeLines = code.map((t) => `- ${t.name}: ${t.value}`);
      const listed = (lines: readonly string[]) =>
        lines.length > FIGMA_LISTED
          ? `${lines.slice(0, FIGMA_LISTED).join("\n")}\n- and ${lines.length - FIGMA_LISTED} more, for a second run`
          : lines.join("\n") || "- none";
      const unmatched = [...byVariable.values()].filter(
        (diffs) => diffs[0]?.outcome === "unmatched"
      ).length;
      return `<ultrapaint-task command="sync">
Match the tokens of the Figma file ${comparison.file} to the code's. A Figma file's names are rarely
the ones the code wants (\`Collection 1/Brand/600\`), and its palette is often more than the
application uses: nothing of Figma's is written to the code until it is matched, and the code's
names win. ${unmatched === 0 ? "Every token is matched already: check the matches, change what is wrong, and stop there." : `${unmatched} are not matched yet.`}

The code's own tokens:
${listed(codeLines)}

Figma's tokens, where each is in Figma (kind, value by theme) → what it is in the code now:
${listed(figmaLines)}

1. Decide what each unmatched token is in the code, and check what the rules matched:
   - a token the code declares, when it is the same thing (the same role, not only the same value);
   - a new token, named the way the code names its tokens, not after Figma's collections:
 \`color-destructive\`, not \`color-collection-1-danger-danger\`;
   - left out, for what the application does not use: a palette step only other variables point
 at, a variable only Figma needs.
   Look at how the components use the code's tokens when a name or a role is unclear.
2. Ask the user with ask_user where the meaning is theirs to say, a group at a time (the brand
   scale, the greys, the semantic colours), with your proposal as the first option.
3. Record the decisions with map_values: kind "figma", value the Figma variable as listed above,
   target the code's token, or keep: true to leave it out.
4. Do not write the stylesheets or the design system. Finish by telling the user to review the
   matches in the Design system panel's Sync view and to press Write there.
${userAdds(extra)}</ultrapaint-task>`;
    });

  const syncCommand = (argument: string) => {
    const { extra, target } = splitArgument(argument);
    if (target === "describe") {
      return syncDescribe(extra);
    }
    if (target === "figma") {
      return syncFigma(extra);
    }
    return Effect.map(
      sync.plan,
      (plan) => `<ultrapaint-task command="sync">
The user ran /sync. The sync is the editor's: its steps are in the Design system panel, where the
user starts each one. Where it stands: ${plan.summary}
Its steps: ${plan.steps.map((s) => `${s.title} (${s.state})`).join("; ")}.
Tell the user, in a sentence or two, what the next step is and that they start it from the panel;
do not do the steps yourself, and stop.
</ultrapaint-task>`
    );
  };

  return { syncCommand };
});
