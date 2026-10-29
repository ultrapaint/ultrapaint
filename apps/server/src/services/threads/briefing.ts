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
  type DesignDocument,
  type DesignSystem,
  TEXT_STYLE_GROUPS,
  type TextStyle,
} from "@ultrapaint/contracts/design-system";
import type { PageList } from "@ultrapaint/contracts/pages";
import { writesGit } from "@ultrapaint/contracts/settings";
import {
  type ComponentSpec,
  DRAFT_FROM,
  SPECS_DIR,
  SYSTEM_FROM,
} from "@ultrapaint/contracts/specs";
import type { ThreadPurpose } from "@ultrapaint/contracts/threads";
import { listedTokens } from "@ultrapaint/contracts/token-table";
import { groupTextStyles } from "@ultrapaint/design-document/text-styles";
import { Context, Effect, Layer } from "effect";
import { ServerConfig } from "../../config.ts";
import { ProjectManager } from "../../project.ts";
import { CatalogueService } from "../catalogue.ts";
import { DesignSystemService } from "../design-system.ts";
import { GitService } from "../git.ts";
import { PagesService } from "../pages.ts";
import { RepoPaths } from "../repo-paths.ts";
import { SkillsService } from "../skills.ts";
import { SpecService } from "../specs.ts";
import { AgentSandbox } from "./agent-sandbox.ts";
import { type AgentWays, agentWays } from "./agent-ways.ts";

/** The styles under their groups: `headings: Heading xl, Heading lg; body: Body`. */
const textStylesByGroup = (styles: readonly TextStyle[]) =>
  [...groupTextStyles(styles)]
    .filter(([, list]) => list.length > 0)
    .map(
      ([group, list]) =>
        `${TEXT_STYLE_GROUPS.find((g) => g.group === group)?.label.toLowerCase() ?? group}: ${list.map((s) => s.name).join(", ")}`
    )
    .join("; ");

/**
 * What the agent is told of `.git`: only where there is one, and the sandbox keeps it read-only.
 * Commits are the user's, made from the editor when writing to git is on.
 */
const dotGitNote = (
  sandboxed: boolean,
  repository: boolean,
  writes: boolean
) =>
  sandboxed && repository
    ? `
The repository's .git is read-only to you: git status, diff and log work, but commits, branches
and stashes are the user's${writes ? ", made from the editor" : ""}.`
    : "";

/** Enough of the components to choose from; the agent reads the rest when it needs to. */
const COMPONENT_LIMIT = 60;

/** A system component as the agent picks one: its variants, and the slots its children can fill. */
const componentLine = (component: ComponentMeta) => {
  const variants = Object.entries(component.variants)
    .map(([name, members]) => `${name}: ${members.join("|")}`)
    .join(", ");
  const slots = (component.slots ?? [])
    .filter((slot) => slot.holds !== undefined)
    .map((slot) =>
      slot.holds === "default" ? `${slot.name} (default)` : slot.name
    )
    .join(", ");
  const about = [variants, slots && `slots: ${slots}`]
    .filter(Boolean)
    .join("; ");
  return `- ${component.name}${about ? ` — ${about}` : ""}`;
};

/** Enough of the tokens to design with; the agent reads the rest from the design system. */
const TOKEN_LIMIT = 80;

const tokensOf = (ds: DesignSystem) => {
  const names = listedTokens(ds).map((t) => t.name);
  const shown = names.slice(0, TOKEN_LIMIT).map((n) => `$${n}`);
  return `${shown.join(" ")}${names.length > shown.length ? ` (and ${names.length - shown.length} more)` : ""}`;
};

/** The shipped and project skills that are on, ahead of the project's own conventions. */
const craftOf = (skills: string) =>
  skills
    ? `
How to design well, whatever the product. The design system's tokens and its conventions,
below, come first where they disagree: a number given here is for what the design system does
not name. Before ending a turn, run each skill's "Before you finish" checks against what you
changed and fix what you find. Tell the user only what you could not fix, or what needs their
decision.

${skills}
`
    : "";

const conventionsOf = (document: DesignDocument | null) =>
  document?.body.trim()
    ? `
Conventions of this design system (${document.path}):
${document.body.trim()}
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

/**
 * What the thread is for (ADR 0030): the design leads and the code follows it. A design thread
 * writes the designs only; behaviour the design cannot show is written down, not coded. An
 * implement thread writes the application from a design.
 */
const roleOf = (purpose: ThreadPurpose, designsDir: string, ways: AgentWays) =>
  purpose === "implement"
    ? `This thread implements: it turns designs into the application's code, and may write the
whole repository. The design is what the UI looks like and which states it has; what it does is
the code's. Token values are the design's: to bring one the code does not have yet over, ${ways.exportTokens("named")}; never the other way without asking. When a design is implemented, ${ways.markImplemented("the page, or spec:<Component>")}`
    : `This thread designs: it may write ${designsDir} only, not the application's code. The design is
what the UI looks like and which states it has (an empty, loading or error state is a page of
its own, orders@empty.page.json); what it does — data, permissions, validation, what a button
calls — is the code's. When the user asks for behaviour, ${ways.noteBehaviour}, and
tell them it goes to the code when the design is implemented (the Implement button). Token values
are the design's: change them in the design system, never in a stylesheet.`;

/**
 * The component specs (ADR 0029): which components' look the design owns, and the drafts the
 * code does not have yet.
 */
const specsOf = (specs: readonly ComponentSpec[]) => {
  const owned = specs.filter((s) => s.look === "design" && !s.draft);
  const drafts = specs.filter((s) => s.draft);
  if (owned.length === 0 && drafts.length === 0) {
    return "";
  }
  return `Component specs in ${SPECS_DIR}/ say how a component looks, apart from what it does, which is
its code's: ${[
    owned.length > 0
      ? `the design owns the look of ${owned.map((s) => s.component).join(", ")}, drawn over the component (change a look in its spec, not on each instance)`
      : null,
    drafts.length > 0
      ? `${drafts.map((s) => s.component).join(", ")} ${drafts.length === 1 ? "is a draft" : "are drafts"}, a component the code does not have yet: place ${drafts.length === 1 ? "it" : "them"} as an instance with from "${DRAFT_FROM}"`
      : null,
  ]
    .filter(Boolean)
    .join("; ")}.

`;
};

export class ProjectBriefing extends Context.Service<
  ProjectBriefing,
  {
    /**
     * The briefing for the open project, for a thread of this purpose (ADR 0030), or nothing when
     * no project is open.
     */
    readonly text: (
      purpose: ThreadPurpose
    ) => Effect.Effect<string | undefined>;
  }
>()("ultrapaint/server/ProjectBriefing") {
  static readonly layer = Layer.effect(
    ProjectBriefing,
    Effect.gen(function* () {
      const project = yield* ProjectManager;
      const ways = agentWays((yield* ServerConfig).mcp);
      const sandbox = yield* AgentSandbox;

      const build = Effect.fnUntraced(function* (purpose: ThreadPurpose) {
        const paths = yield* RepoPaths;
        const pages = yield* (yield* PagesService).list;
        // A catalogue that is not built yet is not worth waiting for: the agent can read the
        // component directory itself, and the next session will have it.
        const catalogue = yield* Effect.orElseSucceed(
          Effect.flatMap(CatalogueService, (service) => service.get(false)),
          () => undefined
        );
        const { settings } = paths;
        // A folder without git has no .git to tell the agent about.
        const gitRepository = yield* (yield* GitService).repository;
        const components = (catalogue?.components ?? []).slice(
          0,
          COMPONENT_LIMIT
        );
        const more = (catalogue?.components.length ?? 0) - components.length;

        const system = yield* Effect.orElseSucceed(
          Effect.flatMap(DesignSystemService, (service) => service.get),
          () => ({ designSystem: null, document: null })
        );
        const ds = system.designSystem;
        const styles = ds?.typography.styles ?? [];
        const skills = yield* Effect.orElseSucceed(
          Effect.flatMap(SkillsService, (service) => service.briefing),
          () => ""
        );
        const craft = craftOf(skills);
        const conventions = conventionsOf(system.document);
        const specs = yield* Effect.orElseSucceed(
          Effect.flatMap(SpecService, (service) => service.specs),
          (): readonly ComponentSpec[] => []
        );

        return `<ultrapaint>
You are working in ultrapaint, a design tool. The user sees the designs you change, live, on
its canvas, drawn with ultrapaint's system components in this design system's tokens and looks.
${roleOf(purpose, settings.designsDir, ways)}

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
- instance: one of ultrapaint's system components (listed below) — component (its name), from
  "${SYSTEM_FROM}", props, and text or children. A child names the slot of its system component it
  fills ("slot": "dialog-footer"); the rest fill the default slot. An overlay (Select, Menu,
  Popover, Tooltip, Dialog, Toast) is drawn open where its props say "open": true; its trigger
  is a slot or its children.
Every node may have width/height ("fill", "hug" or pixels), min/max sizes, padding, margin, fill
(background), border, radius, shadow, opacity, hidden, locked (only the editor reads it: the
user locked it against stray clicks; leave it), and link: where the prototype goes when
it is pressed, a page file of the canvas ("pricing.page.json", preferred: it survives a change of
URL and reaches a page without one), a URL with its parameters ("/invoices/42"), "back", or
another site ("https://…").
Padding and margin are one value for every side or { top, right, bottom, left }; space between
siblings is the parent's gap, and margin is for the one child that stands apart.
Numbers are pixels; "$name" is a design token, the Tailwind v4 variable --name.
An instance's width, height, padding and fill are the component's own, on the canvas as in the
code: size a component with them, not with a className prop. "fill" takes the room the parent
leaves, so a parent whose size follows its content has none to give${ways.tools ? `; ${ways.tools.apply_operations} warns` : ""}.

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
    ? `System components you can place${more > 0 ? ` (${more} more: list them with the tools)` : ""}:
${components.map(componentLine).join("\n")}`
    : ""
}

${ways.changingDesigns}

${specsOf(specs)}Your shell already starts in ${paths.root}, the repository: use paths relative to it, and
stay inside it. Changes land on the canvas as you make them, so make them one
step at a time rather than rewriting a page wholesale. ultrapaint.config.json is the user's:
never write it; when styles are missing, send the user to Sync in the Design system panel.${dotGitNote(sandbox.available, gitRepository, writesGit(settings))}
</ultrapaint>`;
      });

      return ProjectBriefing.of({
        text: (purpose) =>
          project
            .use(build(purpose))
            // No project open, or a repository the server cannot read: the agent manages without.
            .pipe(Effect.orElseSucceed(() => undefined)),
      });
    })
  );
}
