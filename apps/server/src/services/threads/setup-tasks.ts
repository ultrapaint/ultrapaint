/**
 * The tasks of the design-system setup's steps that an agent runs (ADR 0023), each in its thread:
 * Define, adopting the theme or proposing a design system, Map and Migrate.
 */
import {
  type DefineMode,
  DefineMode as DefineModeSchema,
  SETUP_STEPS,
} from "@ultrapaint/contracts/design-system-setup";
import type { NotConfigured } from "@ultrapaint/contracts/errors";
import { plural } from "@ultrapaint/shared/text";
import { Effect, Schema } from "effect";
import { ServerConfig } from "../../config.ts";
import { ProjectManager } from "../../project.ts";
import { DesignSystemService } from "../design-system.ts";
import { DesignSystemSetupService } from "../design-system-setup.ts";
import { inventoryBrief, mappingCounts } from "../design-system-setup-rules.ts";
import { RepoPaths } from "../repo-paths.ts";
import { DESIGN_MD_GUIDE, splitArgument, userAdds } from "./task-text.ts";

const isDefineMode = Schema.is(DefineModeSchema);

/** Values of the mapping a Map task lists, each way. */
const MAP_LISTED = 200;

export const makeSetupTasks = Effect.fnUntraced(function* (deps: {
  /** What `/init` asks for, which Define asks for too when it adopts the theme. */
  readonly importSteps: Effect.Effect<string, NotConfigured>;
}) {
  const { importSteps } = deps;
  const project = yield* ProjectManager;
  const setup = yield* DesignSystemSetupService;
  const { mcp } = yield* ServerConfig;

  /** How an agent's step ends: it says so, and the user goes on from the Setup view. */
  const finishing = (step: string) =>
    mcp
      ? `End by calling finish_setup_step with a summary of a few lines: what you wrote, and what you
   were unsure of. The user reviews the step and goes on to the next one; ${step} is all this thread does.`
      : `End with a summary of a few lines: what you wrote, and what you were unsure of. The user marks
   the step done in the Setup view.`;

  const defineAdopt = (extra: string, brief: string) =>
    Effect.map(
      importSteps,
      (steps) => `<ultrapaint-task command="design-system">
This is the Define step of the design-system setup, adopting the theme, which the user follows in
the Design system panel's Setup view. The theme is the design system: import it into ultrapaint, so that designs are
drawn with its tokens and components and every agent knows its conventions. Only Tailwind v4 is
supported. Change no other file: bringing the code onto the design system is a later step.

${brief}

${steps}
   Say in DESIGN.md's Do's and Don'ts what the code does off the system that the team should
   stop doing.
5. ${finishing("Define")}
${userAdds(extra)}</ultrapaint-task>`
    );

  const definePropose = (extra: string, brief: string, reason: string) =>
    project.use(
      Effect.gen(function* () {
        const { settings } = yield* RepoPaths;
        const stylesheets =
          settings.hostCss.join(", ") ||
          "none configured yet: ask the user which stylesheet sets up Tailwind";
        const tools = mcp
          ? "scan_design_system has what the theme declares; ask_user puts a card of questions to the user; write_design_system saves the result."
          : "Without the editor's MCP server, read the code yourself, ask in the thread and write the files by hand.";
        return `<ultrapaint-task command="design-system">
This is the Define step of the design-system setup, proposing a design system, which the user
follows in the Design system panel's Setup view. The theme does not carry a design system yet (${reason}), so make one from
what the code uses, with the user, and write it as the Tailwind v4 theme. Change no file but the
stylesheet and the design system's own: bringing the code onto the tokens is a later step.

${brief}

${tools}

1. Go through the values above kind by kind, and look at the screens that use the most of them
   to see what each colour, size and shadow is for.
2. Draw up a proposal, small: what the product needs, not every value it has.
   - Colours: near-identical ones are one (#333, #343434 and gray-700 are one grey). A semantic
 layer first — background, foreground, card, popover, primary, secondary, muted, accent,
 destructive, border, input, ring, each surface with a -foreground for the text on it — then
 the palettes those are drawn from, one ramp per hue the product uses. Keep the names the code
 already uses where it has them, and a dark theme if the code has one.
   - Spacing: the base, usually 4px; the values off it are snapped to it later.
   - Type: the sizes in use made a scale, the weights in use, and the text styles (headings, body,
 captions, labels).
   - Radii, shadows and the z-index layers: the few in use, on Tailwind's names (radius-md, shadow-lg).
3. Put the decisions to the user with ask_user, a few questions a card: the brand colour, which
   near-duplicates are one colour, what to call them, the base of the scale. Give the values (hex,
   px) in the options and your choice first. Wait for the answers.
4. Write the tokens into the stylesheet the preview imports (${stylesheets}) as @theme variables:
   --color-*, --spacing, --text-*, --font-weight-*, --radius-*, --shadow-*. Keep what it has. A
   colour that changes with the theme is a custom property set in :root and .dark and named in
   \`@theme inline\` (--color-primary: var(--primary)).
5. Call scan_design_system again and save the result with write_design_system, curated as /init
   does: semantic colours first with what each is for, the text styles, the components with their
   category and example props, the elevation levels. And DESIGN.md: ${DESIGN_MD_GUIDE}
   Its Do's and Don'ts say what the code must stop doing.
6. ${finishing("Define")}
${userAdds(extra)}</ultrapaint-task>`;
      })
    );

  /** Map and Migrate work through the editor's tools; without them they cannot. */
  const needsTools = (step: string) =>
    `<ultrapaint-task command="design-system">
The user ran the ${step} step of the design-system setup, which works through the editor's MCP
server, and the server was started without it. Tell the user to start it with MCP on, and stop.
</ultrapaint-task>`;

  const mapTask = (extra: string) =>
    Effect.gen(function* () {
      const mapping = yield* setup.mapping;
      if (!mapping) {
        return `<ultrapaint-task command="design-system">
The user ran /design-system map, but Map has not started: there is no mapping yet. Tell the user
to start Map from the Design system panel's Setup view, and stop.
</ultrapaint-task>`;
      }
      const counts = mappingCounts(mapping);
      const line = (e: (typeof mapping.entries)[number]) =>
        `- ${e.kind} ${e.value}, ${e.count}×${e.example ? `: ${e.example}` : ""}${e.where ? ` (${e.where})` : ""}${e.target ? ` → ${e.target}` : ""}`;
      const open = mapping.entries
        .filter((e) => e.target === undefined && !e.keep)
        .slice(0, MAP_LISTED)
        .map(line);
      const settled = mapping.entries
        .filter((e) => e.by === "rule")
        .slice(0, MAP_LISTED)
        .map(line);
      return `<ultrapaint-task command="design-system">
This is the Map step of the design-system setup, which the user follows in the Design system
panel's Setup view. Decide what each value of the code that is off the design system becomes.
Change no file: Migrate, the next step, rewrites the code from the mapping.

The mapping has ${plural(mapping.entries.length, "value")} off the system: the rules settled ${counts.byRule}
exactly, ${counts.undecided} are undecided and ${counts.kept} kept. Each is its kind, its value, how
often it is used, how it is written and where first.${open.length > 0 ? `\n\nUndecided, most used first:\n${open.join("\n")}` : ""}${settled.length > 0 ? `\n\nSettled by the rules (change any that is wrong):\n${settled.join("\n")}` : ""}

map_values saves decisions and says how many are left undecided, read_design_system has the
tokens, ask_user puts a card of questions to the user.

1. Read the design system, then the undecided values kind by kind. Where a value's role is not
   clear from how it is written, open the file where it is used.
2. Decide each one:
   - a token of its kind, as target. A colour becomes the token of its role: Tailwind's palette
 colours the semantic token they stand for (text-gray-500 for secondary text is
 color-muted-foreground), near-identical colours the same token. A length becomes the nearest
 step or token: 13px is spacing-3, 15px text-sm or text-base, whichever the design uses. A
 z-index becomes the elevation's layer.
   - the component, for a plain element whose job the library's component does (target Button).
   - kept as it is (keep: true), with a note on why, for a value that has to stay: a brand colour
 outside the system, an offset a layout depends on, an element the component cannot replace.
3. Ask the user with ask_user where the meaning is not yours to decide (which grey is the muted
   one, whether a colour is the brand's), a few values a card, your choice first. Wait for the
   answers.
4. Save the decisions with map_values, up to 50 a call; it says what it could not take and why.
   Leave nothing undecided that is used more than once.
5. ${finishing("Map")}
${userAdds(extra)}</ultrapaint-task>`;
    });

  const migrateTask = (extra: string) =>
    Effect.gen(function* () {
      const { steps } = yield* setup.get;
      const migrate = steps.find((s) => s.id === "migrate");
      const batches = migrate?.batches ?? [];
      const left = batches.filter((b) => b.status !== "done");
      return `<ultrapaint-task command="design-system">
This is the Migrate step of the design-system setup, which the user follows in the Design system
panel's Setup view. Bring the code onto the design system as the mapping says, a batch at a time.
A batch is the files of one directory; the user can revert each one on its own, so keep to the
batch's files.

${batches.length === 0 ? "There are no batches: nothing the mapping settles is left in the code." : `${plural(batches.length, "batch", "batches")}, ${left.length} still to do: ${left.map((b) => `${b.dir} (${plural(b.files.length, "file")})`).join(", ")}.`}

1. Call next_batch. It rewrites what the mapping settles mechanically (classes, style values,
   stylesheet declarations) and returns, file by file, what is left: each use with what the
   mapping says it becomes as target, or no target where the mapping has not decided.
2. Rewrite what is left in the batch's files yourself:
   - a colour or a length in a constant, a computed style or a template onto the token: the
 class (bg-primary, p-3) or the variable (var(--color-primary), calc(var(--spacing) * 3));
   - a plain element onto the component the mapping names, imported the way the files around it
 import it, keeping what it does: its type, handlers, disabled, ref and aria props;
   - a use without a target stays as it is, and so does whatever the mapping keeps.
3. Run the repository's type check and linter (package.json says how) and fix what the batch
   broke.
4. Call next_batch again with done: one line on what you did and what you left. It ends the
   batch and gives you the next, until it says no batch is left.
5. ${finishing("Migrate")}
${userAdds(extra)}</ultrapaint-task>`;
    });

  /** Define, adopting the theme or proposing one: as the user said, or as the step was started. */
  const defineTask = (argument: string) =>
    Effect.gen(function* () {
      const { extra: words, target: first } = splitArgument(argument);
      const given = isDefineMode(first) ? first : undefined;
      const extra = given ? words : argument.trim();
      const state = yield* setup.get;
      const inventory = yield* setup.inventory;
      const { designSystem, document } = yield* project.use(
        Effect.flatMap(DesignSystemService, (d) => d.get)
      );
      // A DESIGN.md from elsewhere (Stitch, a designer) is what the product is meant to be.
      const intent =
        document && !designSystem
          ? `\n\nThe repository has a DESIGN.md (${document.path}), which read_design_system returns: it says what the product is meant to look like, with tokens in its front matter. Propose from it first, keep what its prose says, and keep its sections; its tokens are matched to the design system's in Sync afterwards.`
          : "";
      const brief = `${
        inventory
          ? inventoryBrief(inventory)
          : "The Inventory step has not run, so what the code uses is not known: read the code yourself."
      }${intent}`;
      const mode: DefineMode =
        given ??
        state.steps.find((s) => s.id === "define")?.mode ??
        inventory?.recommendation.mode ??
        "adopt";
      return mode === "propose"
        ? yield* definePropose(
            extra,
            brief,
            inventory?.recommendation.reason ?? "the user asked for one"
          )
        : yield* defineAdopt(extra, brief);
    });

  const designSystemStep = (argument: string) => {
    const { extra, target } = splitArgument(argument);
    if (target === "define") {
      return defineTask(extra);
    }
    if (target === "map" || target === "migrate") {
      return mcp
        ? (target === "map" ? mapTask : migrateTask)(extra)
        : Effect.succeed(needsTools(target === "map" ? "Map" : "Migrate"));
    }
    const offered = SETUP_STEPS.filter((s) => s.agent)
      .map((s) => s.id)
      .join(", ");
    return Effect.succeed(`<ultrapaint-task command="design-system">
The user ran /design-system ${target}, which is not a step an agent runs. The steps that are: ${offered}.
The setup is in the Design system panel's Setup view, where each step is started in order; tell the
user so, and stop.
</ultrapaint-task>`);
  };

  return { designSystemStep };
});
