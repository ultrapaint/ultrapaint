/**
 * What an agent is told about the project before its first prompt.
 *
 * Without it an agent opens a repository it has never seen and works out by reading where the
 * designs live, what a page is, how pages navigate, and which components it may use — a dozen
 * tool calls before the first edit, every session. None of that is a secret: the server already
 * knows all of it, so it says so once, at the start.
 *
 * It is plain text sent with the first prompt of a session, so it works with any ACP agent
 * rather than only those with a system prompt to append to.
 */
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import {
  type DesignSystem,
  TEXT_STYLE_GROUPS,
  type TextStyle,
} from "@ultrapaint/contracts/design-system";
import type { PageList } from "@ultrapaint/contracts/pages";
import { groupTextStyles } from "@ultrapaint/design-document/text-styles";
import { Context, Effect, Layer } from "effect";
import { ServerConfig } from "../../config.ts";
import { ProjectManager } from "../../project.ts";
import { CatalogueService } from "../catalogue.ts";
import { DesignSystemService } from "../design-system.ts";
import { PagesService } from "../pages.ts";
import { RepoPaths } from "../repo-paths.ts";
import { SkillsService } from "../skills.ts";
import { AgentSandbox } from "./agent-sandbox.ts";

/** The styles under their groups: `headings: Heading xl, Heading lg; body: Body`. */
const textStylesByGroup = (styles: readonly TextStyle[]) =>
  [...groupTextStyles(styles)]
    .filter(([, list]) => list.length > 0)
    .map(
      ([group, list]) =>
        `${TEXT_STYLE_GROUPS.find((g) => g.group === group)?.label.toLowerCase() ?? group}: ${list.map((s) => s.name).join(", ")}`
    )
    .join("; ");

/** Enough of the palette to choose from; the agent reads the rest when it needs to. */
const COMPONENT_LIMIT = 60;

const componentLine = (component: ComponentMeta) => {
  const variants = Object.entries(component.variants)
    .map(([name, members]) => `${name}: ${members.join("|")}`)
    .join(", ");
  return `- ${component.name} (${component.importFrom})${variants ? ` — ${variants}` : ""}`;
};

/** Enough of the tokens to design with; `read_design_system` has the rest. */
const TOKEN_LIMIT = 80;

const tokensOf = (ds: DesignSystem) => {
  const names = [
    ...ds.colors.flatMap((g) => g.tokens.map((t) => t.name)),
    ...ds.typography.sizes.map((t) => t.name),
    ...ds.typography.weights.map((t) => t.name),
    ...ds.typography.fonts.map((t) => t.name),
    ...ds.radius.map((t) => t.name),
    ...ds.shadows.map((t) => t.name),
  ];
  const shown = names.slice(0, TOKEN_LIMIT).map((n) => `$${n}`);
  return `${shown.join(" ")}${names.length > shown.length ? ` (and ${names.length - shown.length} more)` : ""}`;
};

/** The shipped and project skills that are on, ahead of the project's own conventions. */
const craftOf = (skills: string) =>
  skills
    ? `
How to design well, whatever the product. The conventions of this design system, below, come
first where they disagree.

${skills}
`
    : "";

const conventionsOf = (notes: string | null) =>
  notes
    ? `
Conventions of this design system (DESIGN.md):
${notes.trim()}
`
    : "";

const pageLine = (page: PageList["pages"][number]) =>
  `- ${page.name}${page.variant === undefined ? "" : ` (variant ${page.variant})`}, ${page.route ?? "no URL"} → ${page.file}`;

/** The pages and their URLs, under their canvas when there are several. */
const pagesListOf = (pages: PageList) => {
  if (pages.pages.length === 0) {
    return "There are no pages yet.";
  }
  if (pages.canvases.length <= 1) {
    return pages.pages.map(pageLine).join("\n");
  }
  return pages.canvases
    .map((canvas) => {
      const own = pages.pages.filter((p) => p.canvas === canvas.id);
      return `${canvas.name} (canvas ${JSON.stringify(canvas.id)}):\n${
        own.length === 0 ? "- no pages yet" : own.map(pageLine).join("\n")
      }`;
    })
    .join("\n");
};

export class ProjectBriefing extends Context.Service<
  ProjectBriefing,
  {
    /** The briefing for the open project, or nothing when no project is open. */
    readonly text: Effect.Effect<string | undefined>;
  }
>()("ultrapaint/server/ProjectBriefing") {
  static readonly layer = Layer.effect(
    ProjectBriefing,
    Effect.gen(function* () {
      const project = yield* ProjectManager;
      const { mcp } = yield* ServerConfig;
      const sandbox = yield* AgentSandbox;

      const build = Effect.gen(function* () {
        const paths = yield* RepoPaths;
        const pages = yield* (yield* PagesService).list;
        // A catalogue that is not built yet is not worth waiting for: the agent can read the
        // component directory itself, and the next session will have it.
        const catalogue = yield* Effect.orElseSucceed(
          Effect.flatMap(CatalogueService, (service) => service.get(false)),
          () => undefined
        );
        const { settings } = paths;
        const components = (catalogue?.components ?? []).slice(
          0,
          COMPONENT_LIMIT
        );
        const more = (catalogue?.components.length ?? 0) - components.length;

        const system = yield* Effect.orElseSucceed(
          Effect.flatMap(DesignSystemService, (service) => service.get),
          () => ({ designSystem: null, notes: null })
        );
        const ds = system.designSystem;
        const styles = ds?.typography.styles ?? [];
        const skills = yield* Effect.orElseSucceed(
          Effect.flatMap(SkillsService, (service) => service.briefing),
          () => ""
        );
        const craft = craftOf(skills);
        const conventions = conventionsOf(system.notes);

        return `<ultrapaint>
You are working in ultrapaint, a design tool. The user sees the designs you change, live, on
its canvas, drawn with this repository's own design system.

Designs live in ${settings.designsDir}, in canvases: a directory with a canvas.json is a canvas
(the designs directory itself when there is only one), and each has its own pages, the URLs they
serve in its prototype and nodes placed beside them — wireframes in one, components in another, a
second version of the application in a third. A link never leaves its canvas, and tools take
\`canvas\` to say which.
A page is a design document, not code: a <name>.page.json file inside its canvas. It may serve a
URL in the canvas's prototype (/settings/billing, /invoices/:id), which canvas.json keeps: a
screen of the application has one, a sketch or a sheet of components needs none, and a page
without one is reached by no link. pricing@bold.page.json is pricing.page.json drawn again for
the variant "bold": it serves the same URL, shown in its place when the prototype is in that
variant. It holds a tree of nodes, each with an id:
- page: the root; lays its children out as a column.
- row, column: flex containers with gap, align (start|center|end|between|around), crossAlign
  (start|center|end|stretch|baseline), wrap, padding.
- group: a plain container; its children stack.
- text: role "heading" (with level 1-6) or "paragraph", its text, and either a textStyle of the
  design system (its size, weight and line height as one thing: prefer this) or its own size,
  weight, lineHeight, font, tracking; and color, align.
- image: src (assets/<file>: the canvas's own assets/ when it has that file, the shared assets/ at the root of the designs directory otherwise; or a URL), alt, fit.
- instance: a component of the design system — component (export name), from (module), props,
  and text or children.
Every node may have width/height ("fill", "hug" or pixels), min/max sizes, padding, margin, fill
(background), border, radius, shadow, opacity, hidden, and link (a URL the prototype follows).
Padding and margin are one value for every side or { top, right, bottom, left }; space between
siblings is the parent's gap, and margin is for the one child that stands apart.
Numbers are pixels; "$name" is a design token, the Tailwind v4 variable --name.
An instance's width, height, padding and fill are the component's own, on the canvas as in the
code: size a component with them, not with a className prop. "fill" takes the room the parent
leaves, so a parent whose size follows its content has none to give; apply_operations warns.

Pages that exist now, with the URL each serves:
${pagesListOf(pages)}

${
  ds
    ? `Design tokens: ${tokensOf(ds)}
${
  styles.length > 0
    ? `Text styles: ${textStylesByGroup(styles)}
`
    : ""
}`
    : `The design system has not been imported yet: the user can run /init.
`
}${craft}${conventions}
${
  components.length > 0
    ? `Components you can place${more > 0 ? ` (${more} more in ${settings.libraryDirs.join(", ")})` : ""}:
${components.map(componentLine).join("\n")}`
    : `Components live in ${settings.libraryDirs.join(", ") || "this repository"}.`
}

${
  mcp
    ? `The "ultrapaint" MCP server is the editor itself. Change designs through it: read_page
and read_canvas return a document with its ids, apply_operations changes it (insert, remove,
move, update, setProps, wrap, unwrap, duplicate) — validated, shown on the canvas at once and
undoable by the user. create_page adds a page (from a template of list_templates), rename_page
renames it, duplicate_page copies it, delete_page deletes it with its variants, set_page_url sets
or takes off its URL, and set_frame sizes its frame on the canvas (a long page needs a tall one to
be seen whole). create_canvas makes a canvas, copy_pages copies or moves pages into another,
set_home says which URL its prototype opens on, and list_links finds the links that lead
nowhere — run it after changing URLs or deleting pages. Ask
get_component for a component's props and an instance to start from, get_document_format for
the whole format. list_comments, reply_to_comment and resolve_comment answer the user where
they asked, and focus tells the canvas which page you are on so the user can watch you work;
before changing nodes, pass their ids to focus as nodes with a few words as action, and the
canvas shows your work on them. Tools name a page by its URL, or by its file when it has none.
A node reference such as /orders#c_8x2k1q (or drafts.page.json#c_8x2k1q), which the user may
paste, is a page and a node id.
After a change, get_screenshot shows you the page or a node as it draws: look, and fix what is off.
When a decision is the user's, ask_user puts your questions to them as a card with answers to
pick; end your turn after it, and the answers come as the next message.
Prefer these to editing the JSON files yourself; if you do write a file, keep it valid.

`
    : `Edit the .page.json files directly and keep them valid; every node needs a unique id.

`
}Your shell already starts in ${paths.root}, the repository: use paths relative to it, and
stay inside it. Changes land on the canvas as you make them, so make them one
step at a time rather than rewriting a page wholesale.${
          sandbox.available
            ? `
The repository's .git is read-only to you: git status, diff and log work, but commits, branches
and stashes are the user's, made from the editor.`
            : ""
        }
</ultrapaint>`;
      });

      return ProjectBriefing.of({
        text: project
          .use(build)
          // No project open, or a repository the server cannot read: the agent manages without.
          .pipe(Effect.orElseSucceed(() => undefined)),
      });
    })
  );
}
