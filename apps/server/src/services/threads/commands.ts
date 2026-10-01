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
import { PageDocument } from "@ultrapaint/contracts/document";
import type { SlashCommand } from "@ultrapaint/contracts/threads";
import { normaliseRoute } from "@ultrapaint/shared/route";
import { Context, Effect, Layer, Schema } from "effect";
import { ServerConfig } from "../../config.ts";
import { ProjectManager } from "../../project.ts";
import { CatalogueService } from "../catalogue.ts";
import { DesignSystemService } from "../design-system.ts";
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
];

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
- fill: bg-*. border: border, border-* and the colour. radius: rounded-*. shadow: shadow-*.
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
      const { mcp } = yield* ServerConfig;

      const init = (extra: string) =>
        project.use(
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
   \`notes\` the whole of DESIGN.md. The tool validates it and tells you what is wrong; fix it
   and call it again. Do not write the two files by hand.`
              : `4. Write ${settings.designsDir}/${DESIGN_SYSTEM_FILE}, valid against this JSON Schema:
   ${designSystemSchema()}
   and ${settings.designsDir}/${DESIGN_NOTES_FILE}.`;
            return `<ultrapaint-task command="init">
Import this repository's design system into ultrapaint, so that designs are drawn with its
tokens and components and every agent knows its conventions. Only Tailwind v4 is supported.

${tools}
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
   - DESIGN.md: what the application is and for whom, the voice, layout conventions, which
     component to use for what, and what to avoid. Short and specific.
5. End with a short summary: what you wrote, and what you were unsure of.
${userAdds(extra)}</ultrapaint-task>`;
          })
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
            return `<ultrapaint-task command="import-figma">
Turn the Figma file "${chosen.name}" (import ${chosen.id}) into pages of this project, drawn with this
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
   allowOther for a name you did not think of. End your turn after asking; carry on when the answers
   come. Do not ask about what the names settle.
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
        return Effect.succeed(null);
      };

      return SlashCommands.of({ expand, list: SLASH_COMMANDS });
    })
  );
}
