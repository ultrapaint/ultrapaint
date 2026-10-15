/**
 * The tasks of `/sync` (ADR 0025): the design system described up to the code, Figma's or
 * DESIGN.md's tokens matched to the code's (ADR 0027), or, with none of these, where the
 * editor's sync stands.
 */
import type { TokenDiff, TokenSourceKind } from "@ultrapaint/contracts/sync";
import { SECTIONS } from "@ultrapaint/design-md/format";
import { mirrorOf } from "@ultrapaint/design-md/mirror";
import { parse } from "@ultrapaint/design-md/parse";
import { groupsOf } from "@ultrapaint/design-md/tokens";
import { Effect } from "effect";
import { ServerConfig } from "../../config.ts";
import { ProjectManager } from "../../project.ts";
import { DesignSystemService } from "../design-system.ts";
import { DesignSystemSyncService } from "../design-system-sync.ts";
import { RepoPaths } from "../repo-paths.ts";
import { ProjectStyleSystem } from "../style-system.ts";
import { DESIGN_MD_GUIDE, splitArgument, userAdds } from "./task-text.ts";

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
Bring the design system up to the code as it is now. Its values are the code's: they are read from
the code every time, so only what each token and component is for is yours to write, here and in
DESIGN.md's prose.
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
1. read_design_system for the design system and DESIGN.md.
2. Each new token: find where the code uses it, put it in the group it belongs to and say in
   \`description\` what it is for. A token the product has on purpose but designers should not
   reach for goes into \`omitted\` instead.
3. Each token gone: take it out. If pages still use it (read_page), tell the user which, and ask
   whether the code should declare it again.
4. Each new component: get_component for its props; give it a \`category\`, a \`description\` and
   \`exampleProps\` that make it render something meaningful. Take out the notes of a component gone.
5. DESIGN.md: say in its prose what changed above, and write what it does not say yet. Prose that
   is not in the format's sections is put in them, keeping what it says; a section the format does
   not know stays, after the others. ${DESIGN_MD_GUIDE}
6. Where what something is for is the user's to say, ask with ask_user, a few at a time.
7. Save with write_design_system, the design system and the whole of DESIGN.md as designMd; then a
   short summary of what changed.
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

  const codeTokens = project.use(
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

  const listed = (lines: readonly string[]) =>
    lines.length > FIGMA_LISTED
      ? `${lines.slice(0, FIGMA_LISTED).join("\n")}\n- and ${lines.length - FIGMA_LISTED} more, for a second run`
      : lines.join("\n") || "- none";

  /** What the task says when a source's tokens cannot be matched here. */
  const unavailable = (source: TokenSourceKind, why: "mcp" | "none") => {
    const command = source === "figma" ? "/sync figma" : "/sync design";
    if (why === "mcp") {
      return `<ultrapaint-task command="sync">
The user ran ${command}, which matches tokens through the editor's MCP server, and the server was
started without it. Tell the user to start it with MCP on, or to match the tokens in the Design
system panel's Sync view, and stop.
</ultrapaint-task>`;
    }
    return source === "figma"
      ? `<ultrapaint-task command="sync">
The user ran /sync figma, but no Figma file has been imported. Tell them to import one from the
Design system panel's Sync view, and stop.
</ultrapaint-task>`
      : `<ultrapaint-task command="sync">
The user ran /sync design, but there is no DESIGN.md at the root of the repository beside a design
system. Tell them to open the Design system panel's Sync view, which moves or writes it, and stop.
</ultrapaint-task>`;
  };

  /**
   * `/sync figma`: an agent matches the newest Figma import's tokens to the code's, with the
   * user, before anything of Figma's is written (ADR 0025). Both lists come in the task.
   */
  const syncFigma = (extra: string) =>
    Effect.gen(function* () {
      if (!mcp) {
        return unavailable("figma", "mcp");
      }
      const comparison = yield* sync.tokens("figma");
      if (!comparison) {
        return unavailable("figma", "none");
      }
      const { lines, unmatched } = sourceLines(comparison.diffs);
      const codeLines = (yield* codeTokens).map(
        (t) => `- ${t.name}: ${t.value}`
      );
      return `<ultrapaint-task command="sync">
Match the tokens of the Figma file ${comparison.file} to the code's. A Figma file's names are rarely
the ones the code wants (\`Collection 1/Brand/600\`), and its palette is often more than the
application uses: nothing of Figma's is written to the code until it is matched, and the code's
names win. ${unmatched === 0 ? "Every token is matched already: check the matches, change what is wrong, and stop there." : `${unmatched} are not matched yet.`}

The code's own tokens:
${listed(codeLines)}

Figma's tokens, where each is in Figma (kind, value by theme) → what it is in the code now:
${listed(lines)}

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

  /**
   * `/sync design`: an agent matches DESIGN.md's tokens to the code's with the user, and settles
   * the text styles, which rules cannot (ADR 0027). Every list comes in the task.
   */
  const syncDesign = (extra: string) =>
    Effect.gen(function* () {
      if (!mcp) {
        return unavailable("design", "mcp");
      }
      const comparison = yield* sync.tokens("design");
      if (!comparison) {
        return unavailable("design", "none");
      }
      const { lines, unmatched } = sourceLines(comparison.diffs);
      const codeLines = (yield* codeTokens).map(
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
Bring ${comparison.file}'s tokens into the code. DESIGN.md is the design system in the open format:
its front matter mirrors the code's tokens, and someone changed it by hand, or it came from
elsewhere (Stitch, a designer) with names of its own (\`tertiary\`, \`surface-container-high\`).
Nothing of it is written to the code until it is matched, and then the code's names win and the
document is rewritten in them. ${unmatched === 0 ? "Every colour, radius and spacing is matched already: check the matches, then the text styles." : `${unmatched} of its tokens are not matched yet.`}

The code's own tokens:
${listed(codeLines)}

The document's tokens, where each is (kind, value) → what it is in the code now:
${listed(lines)}

Its text styles${differ.length > 0 ? `, ${differ.length} of them different from the code's` : ", the same as the code's"}:
${listed(styleLines(styles.doc))}

The design system's text styles, as the document would write them:
${listed(styleLines(styles.ours))}

1. Match each unmatched token: a token the code declares when it is the same thing (the same role,
   not only the same value), a new token named the way the code names its tokens, or left out.
   Read the document's prose: it says what each colour is for.
2. Ask the user with ask_user where the meaning is theirs to say, a group at a time, with your
   proposal as the first option.
3. Record the decisions with map_values: kind "design", value the token's place as listed above
   (\`colors.tertiary\`), target the code's token, or keep: true to leave it out.
4. The text styles are several tokens each, so they are yours to settle with the user: a style of
   the document becomes a text style of design-system.json named so its key comes out the same
   (\`headline-lg\` is "Headline lg"), set in the code's tokens; where it needs a size, weight or
   line height the code does not have, add the token to the stylesheet's theme. Save with
   write_design_system, passing the design system and the whole of DESIGN.md as it is.
5. Do not write the colours, radii or spacing into the stylesheets yourself. Finish by telling the
   user to review the matches in the Design system panel's Sync view and to press Write there.
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
    if (target === "design") {
      return syncDesign(extra);
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
