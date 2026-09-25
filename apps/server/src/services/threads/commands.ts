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
import { DesignSystemService } from "../design-system.ts";
import { DocumentService } from "../documents.ts";
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
    argument: "<route>",
    description: "Turn a page of the design into the application's own code",
    name: "implement",
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
- page: the route's page component. row: flex flex-row. column: flex flex-col. group: a plain
  div. gap: gap-*. align start/center/end/between/around: justify-start/center/end/between/around.
  crossAlign: items-*. wrap: flex-wrap. padding: p-*, or px/py/pt/pr/pb/pl for sides.
- width or height "fill": flex-1 along the parent's direction, self-stretch across it, w-full
  in a group. "hug": w-fit or h-fit. A number: a fixed size (w-80 or w-[320px]).
- fill: bg-*. border: border, border-* and the colour. radius: rounded-*. shadow: shadow-*.
  opacity: opacity-*. hidden: leave the node out.
- text: role heading with level n is <hN>, paragraph is <p>; size, weight, font, lineHeight,
  tracking, color and align are the matching utilities; textStyle names a text style of the
  design system — use the classes that style stands for.
- instance: the component \`component\` imported from \`from\`, with \`props\` as its props and
  \`text\` or \`children\` as its children.
- image: <img>; an "assets/..." src is a file in the space's assets directory — copy it to where
  the application keeps images.
- link: the application's own router link to that route.`;

/** What the user typed after the command's argument, passed on as it is. */
const userAdds = (extra: string) =>
  extra ? `\nThe user adds:\n${extra}\n` : "";

const textStyles = (styles: readonly TextStyle[]) =>
  styles.length > 0
    ? `
Text styles of the design system:
${styles.map((style) => `- ${style.name}: ${JSON.stringify(style)}`).join("\n")}
`
    : "";

const unknownPage = (target: string, routes: readonly string[]) => {
  const which = target ? `no page serves ${target}` : "did not say which";
  return `<ultrapaint-task command="implement">
The user asked to implement a page of the design, but ${which}. The routes are: ${routes.join(", ") || "none"}. Ask which one.
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
   - typography.styles: the named text styles the product uses (Display, Heading 1, Body,
     Caption…), each with role heading or paragraph, a level for headings, and tokens such as
     "$text-4xl" and "$font-weight-bold".
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
            const route = target ? normaliseRoute(target) : "";
            const page =
              pages.find((p) => p.route === route || p.id === target) ??
              (pages.length === 1 ? pages[0] : undefined);
            if (!page) {
              return unknownPage(
                target,
                pages.map((p) => p.route)
              );
            }
            const state = yield* Effect.orElseSucceed(
              (yield* DocumentService).get(page.id),
              () => null
            );
            const { designSystem } = yield* (yield* DesignSystemService).get;
            const styles = designSystem?.typography.styles ?? [];
            return `<ultrapaint-task command="implement">
Implement the page ${page.route} of the design (${page.file}) in this repository's application,
in its own conventions.

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
        return Effect.succeed(null);
      };

      return SlashCommands.of({ expand, list: SLASH_COMMANDS });
    })
  );
}
