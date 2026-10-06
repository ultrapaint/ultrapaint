/**
 * Commands a prompt may start with. The composer offers them after a `/`; the server expands one
 * into the task it stands for before the agent sees the prompt, so the task is written once,
 * here, with what the project knows filled in — and the transcript still shows what the user
 * typed.
 */

import {
  DESIGN_NOTES_FILE,
  DESIGN_SYSTEM_FILE,
  DesignSystem,
  type TextStyle,
} from "@ultrapaint/contracts/design-system";
import {
  type DefineMode,
  DefineMode as DefineModeSchema,
  SETUP_STEPS,
} from "@ultrapaint/contracts/design-system-setup";
import { PageDocument } from "@ultrapaint/contracts/document";
import type { SlashCommand } from "@ultrapaint/contracts/threads";
import { normaliseRoute } from "@ultrapaint/shared/route";
import { Context, Effect, Layer, Schema } from "effect";
import { ServerConfig } from "../../config.ts";
import { ProjectManager } from "../../project.ts";
import { CatalogueService } from "../catalogue.ts";
import { DesignSystemService } from "../design-system.ts";
import { DesignSystemSetupService } from "../design-system-setup.ts";
import {
  inventoryBrief,
  mappingCounts,
  plural,
} from "../design-system-setup-rules.ts";
import { DocumentService } from "../documents.ts";
import { FigmaImportService } from "../figma-import.ts";
import { PagesService } from "../pages.ts";
import { RepoPaths } from "../repo-paths.ts";

const COMMAND_RE = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/;
const WHITESPACE_RE = /\s+/;

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    description:
      "Import the repository's design system: tokens, text styles, components and conventions",
    name: "init",
  },
  {
    argument: "<page>",
    description: "Turn a page of the design into the application's own code",
    name: "implement",
  },
  {
    description:
      "Turn an imported Figma file into pages, with its components replaced by the repository's",
    name: "import-figma",
  },
  {
    argument: "<canvas> <what to change>",
    description:
      "Change every page of a canvas, a copy made to take another way: to wireframes, to finished screens",
    name: "redraw",
  },
  {
    argument: "<canvas>",
    description:
      "Draw a sheet of the design system's components, in each of their variants, into a canvas",
    name: "components",
  },
  {
    argument: "<step>",
    description:
      "Run a step of the design-system setup (Design system → Setup): define, map or migrate",
    name: "design-system",
  },
];

const isDefineMode = Schema.is(DefineModeSchema);

/** Values of the mapping a Map task lists, each way. */
const MAP_LISTED = 200;

/** The design system's schema, for an agent that has to write the file without the tools. */
export const designSystemSchema = () =>
  JSON.stringify(Schema.toJsonSchemaDocument(DesignSystem).schema);

/** The page format's schema, for agents. */
export const pageSchema = () =>
  JSON.stringify(Schema.toJsonSchemaDocument(PageDocument));

/**
 * How the format's tokens and nodes become Tailwind v4 and components. The editor's Code tab
 * writes the same translation out (`@ultrapaint/design-document/code`): change both together.
 */
export const IMPLEMENTATION_RULES = `How the design maps to code (Tailwind v4):
- A token "$name" is the theme variable --name. "$color-primary" is bg-primary, text-primary,
  border-primary; "$radius-lg" is rounded-lg; "$shadow-md" is shadow-md; "$text-lg" is text-lg;
  "$font-weight-semibold" is font-semibold; "$font-sans" is font-sans; "$leading-tight" is
  leading-tight; "$tracking-wide" is tracking-wide; "$spacing-4" is the 4 step (p-4, gap-4).
- A number is pixels. Put it on the spacing scale (one step is the design system's spacing base,
  usually 4px: 16 is p-4) and use an arbitrary value only when it is off the scale.
- page: the page component of the URL it serves. row: flex flex-row. column: flex flex-col. group: a plain
  div. gap: gap-*. align start/center/end/between/around: justify-start/center/end/between/around.
  crossAlign: items-*. wrap: flex-wrap. padding: p-*, or px/py/pt/pr/pb/pl for sides. margin: the
  same with m (m-*, mx-*, -mt-*).
- width or height "fill": flex-1 along the parent's direction, self-stretch across it, w-full
  or h-full in a group. "hug": w-fit or h-fit. A number: a fixed size (w-80 or w-[320px]).
  Inside an instance, "the parent" is the element of the component that holds its children:
  read the component to see whether it is a flex row, a flex column or a block.
- fill: bg-*. border: border, border-* and the colour; "$border-width-*" is
  border-(length:--border-width-*). radius: rounded-*. shadow: shadow-*. "$container-md" in
  maxWidth or minWidth is max-w-md or min-w-md.
  opacity: opacity-*. hidden: leave the node out.
- text: role heading with level n is <hN>, paragraph is <p>; size, weight, font, lineHeight,
  tracking, color and align are the matching utilities; textStyle names a text style of the
  design system — write all of the classes that style stands for (its size, weight and line
  height, and its font and tracking when it sets them), then the node's own fields over them.
- instance: the component \`component\` imported from \`from\`, with \`props\` as its props and
  \`text\` or \`children\` as its children. Its size, padding, fill, border, radius and shadow
  are classes in the component's own className, as the canvas draws them; a component that
  does not take a className gets them on a div around it (flex flex-col, then the classes).
- image: <img>; an "assets/..." src is a file of the canvas's own assets/ directory when it has
  one, and of the shared assets/ at the root of the designs directory otherwise — copy it to
  where the application keeps images.
- link: the application's own router link. A page file (pricing.page.json) links to the URL that
  page serves (list_pages says which); a URL links to itself; "back" goes back in the router's
  history; another site is a plain anchor. A link to a page without a URL: ask where it goes.`;

/** What the user typed after the command's argument, passed on as it is. */
const userAdds = (extra: string) =>
  extra ? `\nThe user adds:\n${extra}\n` : "";

const QUOTED_ROOT = '""';

/** A canvas as a command names it: its id, `""` for the designs directory's own. */
const canvasArgument = (argument: string) => {
  const [target = "", ...rest] = argument.trim().split(WHITESPACE_RE);
  return { extra: rest.join(" "), id: target === QUOTED_ROOT ? "" : target };
};

const named = (id: string) => JSON.stringify(id);

const unknownCanvas = (
  command: string,
  id: string,
  canvases: readonly { readonly id: string; readonly name: string }[]
) => `<ultrapaint-task command="${command}">
The user ran /${command}, but there is no canvas ${named(id)}. The canvases are: ${canvases.map((c) => `${c.name} (${named(c.id)})`).join(", ") || "none"}. Ask which one.
</ultrapaint-task>`;

const textStyles = (styles: readonly TextStyle[]) =>
  styles.length > 0
    ? `
Text styles of the design system:
${styles.map((style) => `- ${style.name}: ${JSON.stringify(style)}`).join("\n")}
`
    : "";

/**
 * The page a command names: by its URL, which names the base page, or by its file, which names
 * a variant's page or one without a URL. Named by nothing, the only page there is.
 */
const pageNamed = <
  T extends {
    readonly file: string;
    readonly id: string;
    readonly path: string;
    readonly route?: string | undefined;
    readonly variant?: string | undefined;
  },
>(
  pages: readonly T[],
  target: string
): T | undefined => {
  if (!target) {
    return pages.length === 1 ? pages[0] : undefined;
  }
  if (target.startsWith("/")) {
    const route = normaliseRoute(target);
    return pages.find((p) => p.route === route && p.variant === undefined);
  }
  return pages.find(
    (p) => p.id === target || p.file === target || p.path === target
  );
};

/** A page as a list shows it to an agent: its name, its URL or that it has none, its file. */
const pageEntry = (page: {
  readonly file: string;
  readonly name: string;
  readonly route?: string | undefined;
  readonly variant?: string | undefined;
}) =>
  `${page.name}${page.variant ? ` (variant ${page.variant})` : ""}, ${page.route ?? "no URL"}: ${page.file}`;

const unknownPage = (
  target: string,
  pages: readonly Parameters<typeof pageEntry>[0][]
) => {
  const which = target ? `no page is ${target}` : "did not say which";
  return `<ultrapaint-task command="implement">
The user asked to implement a page of the design, but ${which}. The pages are:
${pages.map((p) => `- ${pageEntry(p)}`).join("\n") || "- none"}
Ask which one.
</ultrapaint-task>`;
};

export class SlashCommands extends Context.Service<
  SlashCommands,
  {
    /**
     * The task a prompt stands for, or null when it does not start with a command this server
     * knows (it then goes to the agent as it is, which may have commands of its own).
     */
    readonly expand: (text: string) => Effect.Effect<string | null>;
    readonly list: readonly SlashCommand[];
  }
>()("ultrapaint/server/SlashCommands") {
  static readonly layer = Layer.effect(
    SlashCommands,
    Effect.gen(function* () {
      const project = yield* ProjectManager;
      const setup = yield* DesignSystemSetupService;
      const { mcp } = yield* ServerConfig;

      /** What `/init` asks for, which Define asks for too when it adopts the theme. */
      const importSteps = project.use(
        Effect.gen(function* () {
          const paths = yield* RepoPaths;
          const { designSystem } = yield* (yield* DesignSystemService).get;
          const { settings } = paths;
          const libraries =
            settings.libraryDirs.join(", ") || "the component library";
          const tools = mcp
            ? `1. Call scan_design_system. It reads the Tailwind v4 @theme blocks of the stylesheets the
   preview imports (${settings.hostCss.join(", ") || "none configured yet"}) and answers with a
   first design system, the files it read, and notes on what it could not interpret.${
     designSystem
       ? `
   A design system was imported before: read_design_system returns it with DESIGN.md. Update
   it rather than start over, and ask only about what changed.`
       : ""
   }`
            : `1. Read the stylesheets the preview imports (${settings.hostCss.join(", ") || "none configured yet"}) and
   their @theme blocks.`;
          const write = mcp
            ? `4. Save it with write_design_system: \`designSystem\` is the design-system.json object and
   \`notes\` the whole of DESIGN.md. get_document_format with kind "design-system" has its JSON
   Schema. The tool validates it and tells you what is wrong; fix it and call it again. Do not
   write the two files by hand.`
            : `4. Write ${settings.designsDir}/${DESIGN_SYSTEM_FILE}, valid against this JSON Schema:
   ${designSystemSchema()}
   and ${settings.designsDir}/${DESIGN_NOTES_FILE}.`;
          return `${tools}
2. Look at what the scan cannot see: the design system's packages (${libraries}), their READMEs,
   AGENTS.md and docs, Storybook stories, style guides, and how the application's own screens use
   the tokens and components.
3. Ask the user, here in the thread, what you cannot find out yourself, a few questions at a
   time, and wait for the answers: what the application is and who uses it, which colours are
   the brand and which are semantic, which text styles the product uses, what to always or never
   do. Skip what you already know.
${write}
   - colors: groups of tokens, the semantic colours first ("Semantic"), then one group per
     palette. Keep only what the product uses; say in \`description\` what a colour is for.
   - typography.styles: the named text styles the product uses, each one a size, a weight and
     a line height (and a font and tracking when it sets them) that a text is set in as one
     thing, in three groups: \`group\` heading (Heading xxl… Heading xs, with role heading and
     a level), body (Body lg, Body, Body sm, role paragraph) and other (Caption, Label, Code).
     Use tokens such as "$text-4xl", "$font-weight-bold" and "$leading-tight". The scan starts
     you off with a scale built from the theme: keep what the product uses, rename and fix the
     rest, drop what it does not have.
   - components: for each component a designer would place, by export name: \`category\`,
     \`description\`, \`exampleProps\` that make it render something meaningful on its own (a
     dialog open, a select with options, a badge with a variant) and \`exampleText\` for one
     that takes text as children.
   - elevation: the levels, lowest first (Sunken, Default, Raised, Overlay), each a \`surface\`
     colour token, the \`shadow\` that goes with it, and the z-index \`layer\` of those that
     overlap. The scan starts you off from the semantic surfaces; fix it from how the product's
     cards, menus and dialogs are styled.
   - borderWidths, layout (breakpoints, containers) and motion (easings, durations,
     animations): the scan reads them from the theme; keep what the product uses and say in
     \`description\` what each is for. A project that hard-codes durations or border widths in
     its components has them read from there.
   - icons: the package the product's icons come from, the sizes it uses, and in
     \`description\` how they are used (stroke width, with or without labels).
   - DESIGN.md: what the application is and for whom, the voice and tone, layout conventions,
     which component to use for what, and what to avoid. Short and specific.`;
        })
      );

      /**
       * What a task says when the editor sees no components: the settings point nowhere. The
       * agent must not try to fix them itself (it has guessed paths before); the user does, in
       * the Sync view, which detects them.
       */
      const componentsMissing = project
        .use(
          Effect.gen(function* () {
            const { settings } = yield* RepoPaths;
            const count =
              settings.libraryDirs.length === 0
                ? 0
                : yield* (yield* CatalogueService).get(false).pipe(
                    Effect.map((c) => c.components.length),
                    Effect.orElseSucceed(() => 0)
                  );
            if (count > 0) {
              return "";
            }
            const where =
              settings.libraryDirs.length === 0
                ? "no component directory is configured"
                : `${settings.libraryDirs.join(", ")} has no components the editor can read`;
            return `Before anything else: the editor sees no components (${where}). Do not write or edit
ultrapaint.config.json or any other configuration to fix it. Tell the user to open the Design
system panel and press Sync, which finds the components and asks them to confirm, then stop.
Go on without components only if the user says the project has none.

`;
          })
        )
        .pipe(Effect.orElseSucceed(() => ""));

      const init = (extra: string) =>
        Effect.zipWith(
          importSteps,
          componentsMissing,
          (steps, missing) => `<ultrapaint-task command="init">
${missing}Import this repository's design system into ultrapaint, so that designs are drawn with its
tokens and components and every agent knows its conventions. Only Tailwind v4 is supported.

${steps}
5. End with a short summary: what you wrote, and what you were unsure of.
${userAdds(extra)}</ultrapaint-task>`
        );

      const implement = (argument: string) =>
        project.use(
          Effect.gen(function* () {
            const [target = "", ...rest] = argument.trim().split(WHITESPACE_RE);
            const extra = rest.join(" ");
            const { pages } = yield* (yield* PagesService).list;
            const page = pageNamed(pages, target);
            if (!page) {
              return unknownPage(target, pages);
            }
            const state = yield* Effect.orElseSucceed(
              (yield* DocumentService).get(page.id),
              () => null
            );
            const { designSystem } = yield* (yield* DesignSystemService).get;
            const styles = designSystem?.typography.styles ?? [];
            return `<ultrapaint-task command="implement">
Implement the page ${page.name} of the design (${page.file}) in this repository's application,
in its own conventions. ${
              page.route === undefined
                ? "It has no URL in the design: ask the user where it belongs before writing anything."
                : `It serves ${page.route} in the design's prototype.`
            }

The design, as the editor holds it:
${JSON.stringify(state?.root ?? null, null, 2)}

${IMPLEMENTATION_RULES}
${textStyles(styles)}
1. Find where the application's pages live and how its routes are declared. If it is not clear
   where this page belongs, ask the user before writing anything.
2. Write the page with the design system's components and the application's existing layouts;
   do not copy the design node by node where a component already does the job.
3. Run the repository's type check and linter on what you changed.
4. End with a short summary, and what the design asked for that the code could not do.
${userAdds(extra)}</ultrapaint-task>`;
          })
        );

      const importFigma = (argument: string) =>
        project.use(
          Effect.gen(function* () {
            const [target = "", ...rest] = argument.trim().split(WHITESPACE_RE);
            const extra = rest.join(" ");
            const figma = yield* FigmaImportService;
            const imports = yield* figma.list;
            const chosen =
              imports.find((i) => i.id === target || i.name === target) ??
              imports[0];
            if (!chosen) {
              return `<ultrapaint-task command="import-figma">
The user asked to import a Figma file, but none has been uploaded. Tell them to use "Import Figma…" in the Pages panel, which takes a .fig file, and stop.
</ultrapaint-task>`;
            }
            const { designSystem } = yield* (yield* DesignSystemService).get;
            const frames = chosen.pages.flatMap((page) =>
              page.frames.map(
                (f) => `${f.name} (${f.id}, ${f.width}×${f.height})`
              )
            );
            const components = chosen.components
              .filter((c) => c.uses > 0)
              .sort((a, b) => b.uses - a.uses)
              .map(
                (c) =>
                  `- ${c.key}: used ${c.uses}×${
                    Object.keys(c.variants).length > 0
                      ? `, variants ${Object.entries(c.variants)
                          .map(
                            ([name, values]) => `${name}=${values.join("|")}`
                          )
                          .join(" ")}`
                      : ""
                  }${
                    c.candidates.length > 0
                      ? `; might be ${c.candidates.map((k) => k.name).join(" or ")}`
                      : "; no component of a similar name here"
                  }`
              );
            const tools = mcp
              ? `Through the ultrapaint MCP server: read_figma_import (the file: frames, components, candidates, the
mapping so far), read_figma_component and read_figma_frame (one of them, with an outline of its layers),
map_figma_component (what a Figma component becomes), write_figma_frame (a frame as a page), ask_user
(a question card for the user), list_components and get_component (this repository's components).`
              : `The import's file is in the state directory under imports/${chosen.id}; without the MCP server the
mapping cannot be written, so tell the user to start the server with MCP on and stop.`;
            const missing = yield* componentsMissing;
            return `<ultrapaint-task command="import-figma">
${missing}Turn the Figma file "${chosen.name}" (import ${chosen.id}) into pages of this project, drawn with this
repository's own components where it has them.

${tools}

The file has ${frames.length} frame${frames.length === 1 ? "" : "s"}: ${frames.join(", ") || "none"}.
Its components, most used first:
${components.join("\n") || "- none"}
${chosen.warnings.length > 0 ? `\nWhat the reading could not carry over:\n${chosen.warnings.map((w) => `- ${w}`).join("\n")}\n` : ""}
${
  designSystem
    ? "The design system is imported: read_design_system has its tokens and each component's notes."
    : "The design system has not been imported yet; components come from list_components. Suggest /init afterwards."
}

1. Read the import (read_figma_import) and the repository's components (list_components). For each Figma
   component, most used first, decide what it becomes:
   - It is one of this repository's components when the name and the variants say so (a Button with
     Size and Type variants is the repository's Button). Read the repository component with
     get_component for its props, then map it with map_figma_component: the variants and text
     properties to its props (propMap), constants to props, the label to text.
   - It is custom when nothing here does the job: map it as {kind:"expand"} and its layers are kept.
   - Decorative ones (a status bar, a cursor, a placeholder image) are {kind:"skip"}.
   Where you cannot tell — a candidate that only looks alike, two candidates, a component this
   repository may have under another name — ask the user with ask_user, up to four components per
   card, each with the candidates as options, "Custom: keep its layers" and "Skip" among them, and
   allowOther for a name you did not think of. Carry on with the answers it returns (if it says the
   questions were shown instead, end your turn; they come as the next message). Do not ask about
   what the names settle.
2. Once every used component is decided, write each frame with write_figma_frame, in the canvas the
   user works in. A screen of the application gets a URL that fits its name ("Login" is /login,
   "Home" is /); a frame that is not a screen (a component sheet, a style guide) gets none, and ask
   whether to import it at all.
3. Look at each page with get_screenshot and mend what the rules got wrong with apply_operations:
   colours the design system has a token for that came through as hex, sizes that should be "fill"
   or "hug", texts that should be set in a text style. Keep the page close to the Figma frame.
4. End with a short summary: the pages written, the mapping, and what to look at by hand.
${userAdds(extra)}</ultrapaint-task>`;
          })
        );

      const redraw = (argument: string) =>
        project.use(
          Effect.gen(function* () {
            const { extra, id } = canvasArgument(argument);
            const { canvases, pages } = yield* (yield* PagesService).list;
            const canvas = canvases.find((c) => c.id === id);
            if (!canvas) {
              return unknownCanvas("redraw", id, canvases);
            }
            const own = pages.filter((p) => p.canvas === id);
            const list = own.map((p) => `- ${pageEntry(p)}`).join("\n");
            const tools = mcp
              ? `Through the ultrapaint MCP server, always passing canvas: ${named(id)}: read_page and
get_screenshot to see a page, apply_operations to change it, focus to show the user where you are,
read_design_system, list_components and get_component for what the design system offers.`
              : `Edit the files above directly; the editor validates each one and reports what is wrong. The
page format: ${pageSchema()}`;
            return `<ultrapaint-task command="redraw">
The canvas "${canvas.name}" (${named(id)}) is a copy the user made to take another way. Change every page of it as
the user asks:
${extra || "(the user did not say what to change: ask before changing anything)"}

Its pages:
${list || "- none"}

${tools}

1. Work page by page. Read the page and look at it before changing it.
2. Change it in place: keep its URL, the links between the pages, and the ids of the nodes you
   keep. Draw with the design system's components and tokens.
3. Look at the page again when it is done and fix what is off: overlaps, clipped text, empty
   instances.
4. Change nothing outside this canvas: the canvas it was copied from stays as it is.
5. End with a short summary: what you changed, and what you left for the user to decide.
</ultrapaint-task>`;
          })
        );

      const components = (argument: string) =>
        project.use(
          Effect.gen(function* () {
            const { extra, id } = canvasArgument(argument);
            const { canvases, pages } = yield* (yield* PagesService).list;
            const canvas = canvases.find((c) => c.id === id);
            if (!canvas) {
              return unknownCanvas("components", id, canvases);
            }
            const { designSystem } = yield* (yield* DesignSystemService).get;
            const catalogue = yield* Effect.orElseSucceed(
              (yield* CatalogueService).get(false),
              () => null
            );
            const known = (catalogue?.components ?? []).map((c) => {
              const notes = designSystem?.components?.[c.name];
              const variants = Object.entries(c.variants)
                .map(([name, values]) => `${name}=${values.join("|")}`)
                .join(" ");
              return `- ${c.name} (${notes?.category ?? c.category})${variants ? `: ${variants}` : ""}`;
            });
            const sheets = pages
              .filter(
                (p) =>
                  p.canvas === id &&
                  (p.name.toLowerCase().startsWith("components") ||
                    p.route?.startsWith("/components") === true)
              )
              .map((p) => p.file);
            return `<ultrapaint-task command="components">
Draw a sheet of this repository's design system into the canvas "${canvas.name}" (${named(id)}): every component a
designer would place, in each of its variants, so the canvas shows what there is to design with.

The components, with their category and variants:
${known.join("\n") || "- none found: call list_components"}
${
  sheets.length > 0
    ? `\nThe canvas has sheets already (${sheets.join(", ")}): bring them up to date rather than drawing them again —
add what is missing, take out what the design system no longer has.\n`
    : ""
}
1. Read the design system (read_design_system) for each component's category, description and
   example props, and get_component for its props and variants.
2. One page per category named "Components <category>" ("Components forms"), or one page named
   "Components" when there are fewer than a dozen components. Create them with create_page and
   canvas: ${named(id)}, without a URL: a sheet is not a screen of the application.
3. In a page, per component: its name as a heading and one line on what it is for, in the design
   system's text styles; under them a row that wraps, with one instance for each value of each
   variant prop (a Button in each variant; for two variant props, one row per value of the first).
   Give every instance its example props and text so it draws something, and show the states it
   has (disabled, loading, invalid) where they change how it looks.
4. Size each page's frame with set_frame, 1440 wide and tall enough to show the whole sheet.
5. Look at every page with get_screenshot and fix what is off: overlaps, clipped content,
   instances that draw nothing.
6. End with a short summary: the pages written, and the components you could not draw and why.
${userAdds(extra)}</ultrapaint-task>`;
          })
        );

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
   Note in DESIGN.md what the code does off the system that the team should stop doing.
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
   category and example props, the elevation levels. DESIGN.md says what the product is, which
   colour means what, and what the code must stop doing.
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
      const defineTask = (rest: readonly string[]) =>
        Effect.gen(function* () {
          const [first = "", ...words] = rest;
          const given = isDefineMode(first) ? first : undefined;
          const extra = (given ? words : rest).join(" ");
          const state = yield* setup.get;
          const inventory = yield* setup.inventory;
          const brief = inventory
            ? inventoryBrief(inventory)
            : "The Inventory step has not run, so what the code uses is not known: read the code yourself.";
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
        const [target = "", ...rest] = argument.trim().split(WHITESPACE_RE);
        if (target === "define") {
          return defineTask(rest);
        }
        if (target === "map" || target === "migrate") {
          return mcp
            ? (target === "map" ? mapTask : migrateTask)(rest.join(" "))
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

      const expand = (text: string) => {
        const match: RegExpExecArray | null = COMMAND_RE.exec(text.trim());
        const name = match?.[1];
        const argument = match?.[2]?.trim() ?? "";
        if (name === "init") {
          return init(argument).pipe(Effect.orElseSucceed(() => null));
        }
        if (name === "implement") {
          return implement(argument).pipe(Effect.orElseSucceed(() => null));
        }
        if (name === "import-figma") {
          return importFigma(argument).pipe(Effect.orElseSucceed(() => null));
        }
        if (name === "redraw") {
          return redraw(argument).pipe(Effect.orElseSucceed(() => null));
        }
        if (name === "components") {
          return components(argument).pipe(Effect.orElseSucceed(() => null));
        }
        if (name === "design-system") {
          return designSystemStep(argument).pipe(
            Effect.orElseSucceed(() => null)
          );
        }
        return Effect.succeed(null);
      };

      return SlashCommands.of({ expand, list: SLASH_COMMANDS });
    })
  );
}
