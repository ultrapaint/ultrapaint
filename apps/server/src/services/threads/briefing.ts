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
import { componentLine } from "@ultrapaint/contracts/catalogue";
import {
  APP_FROM,
  type ComponentFile,
  SYSTEM_FROM,
} from "@ultrapaint/contracts/components";
import {
  type DesignDocument,
  type DesignSystem,
  TEXT_STYLE_GROUPS,
  type TextStyle,
} from "@ultrapaint/contracts/design-system";
import type { PageList } from "@ultrapaint/contracts/pages";
import { writesGit } from "@ultrapaint/contracts/settings";
import type { ThreadPurpose } from "@ultrapaint/contracts/threads";
import { listedTokens } from "@ultrapaint/contracts/token-table";
import { groupTextStyles } from "@ultrapaint/design-document/text-styles";
import { catalogueOf } from "@ultrapaint/system-components/catalogue";
import { DEFAULT_LOOK } from "@ultrapaint/system-components/default-look";
import { Context, Effect, Layer } from "effect";
import { ServerConfig } from "../../config.ts";
import { OpenProject } from "../../project.ts";
import { ComponentService } from "../components.ts";
import { DesignSystemService } from "../design-system.ts";
import { GitService } from "../git.ts";
import { PagesService } from "../pages.ts";
import { RepoPaths } from "../repo-paths.ts";
import { SkillsService, type SkillsTold } from "../skills.ts";
import { canvasesIn, componentFiles, PAGES } from "./agent-docs.ts";
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

/**
 * What an agent is told of a project with no design system of its own (ADR 0062, amending 0050):
 * it draws in the default look and says so once; it writes a design system only when asked, or
 * in a new project, whose theme declares nothing.
 */
export const DEFAULT_LOOK_NOTE = `This project has no design system of its own: its designs are drawn in Ultrapaint's default
look, whose tokens are below. Draw with them, and say once in your reply that the design uses the
default look until the user makes the project's own in the Design system tab (from the code, a
new look or Figma). Do not write a design system unless the user asks for one, or the project is
new and its theme declares nothing.`;

/**
 * What an agent is told of a design system whose colours are named by property and meaning (ADR
 * 0062): which namespace serves which property, and that each serves only its own.
 */
export const DETAILED_NOTE = `Its colours are named by property and meaning: text-color-* for text, background-color-* for
fills, border-color-* for borders (in the code, text-subtle, bg-danger-subtle, border-focus). Use
each only for its own property, the one whose meaning fits: never a background colour on text.`;

/** Enough of the components to choose from; the agent reads the rest when it needs to. */
const COMPONENT_LIMIT = 60;

/** Enough of the tokens to design with; the agent reads the rest from the design system. */
const TOKEN_LIMIT = 80;

const tokensOf = (ds: DesignSystem) => {
  const names = listedTokens(ds).map((t) => t.name);
  const shown = names.slice(0, TOKEN_LIMIT).map((n) => `$${n}`);
  return `${shown.join(" ")}${names.length > shown.length ? ` (and ${names.length - shown.length} more)` : ""}`;
};

/**
 * The shipped and project skills that are on, ahead of the project's own conventions: whole, or
 * by their titles and summaries, each read whole where its line says (`SkillsTold`).
 */
const craftOf = ({ listed, whole }: SkillsTold) => {
  if (listed.length === 0 && whole === "") {
    return "";
  }
  const lead = `How to design well, whatever the product. The design system's tokens and its conventions,
below, come first for what they choose (a value, a variant, one of two allowed ways): a number
given here is for what the design system does not name. Where they only restate a rule given
here, the rule holds as it is given here, its condition with it.`;
  if (listed.length === 0) {
    return `
${lead} Before ending a turn, run each skill's "Before you finish" checks against what you
changed and fix what you find. Tell the user only what you could not fix, or what needs their
decision.

${whole}
`;
  }
  return `
${lead} Each skill is listed by its title, where to read it whole and what it is
about: read a skill whole before the work it is about. Before ending a turn, run the "Before
you finish" checks of each skill you read against what you changed and fix what you find. Tell
the user only what you could not fix, or what needs their decision.

${listed.join("\n")}
${whole ? `\nThese have no file of their own to read, so they are told whole:\n\n${whole}\n` : ""}`;
};

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
the code's. Token values are the design's: to bring one the code does not have yet over, ${ways.exportTokens("named")}; never the other way without asking. When a design is implemented, ${ways.markImplemented("the page, or component:<Name>")}`
    : `This thread designs: it may write ${designsDir} only, not the application's code. The design is
what the UI looks like and which states it has (an empty, loading or error state is a page of
its own, orders@empty.page.json); what it does — data, permissions, validation, what a button
calls — is the code's. When the user asks for behaviour, ${ways.noteBehaviour}, and
tell them it goes to the code when the design is implemented (the Implement button). Token values
are the design's: change them in the design system, never in a stylesheet.`;

/**
 * How a design thread speaks and works in the chat (ADR 0063): an assistant at work on the
 * method, its plan the run card's steps, the editor's review loop answered, one question at a time.
 */
const DESIGN_CHAT = `How you work in this chat:
- Before the first node, say your plan once, in at most three sentences: the page, its sections
  and the states each will have. Then work; don't narrate each step.
- Keep your plan (your todo list) as "Outline", then one "Build <section>" per section, ticked
  off as you go: the chat shows it as the run's progress.
- When your turn ends, the editor has the user's review models look at what you made and sends
  you their findings. Fix each, or decline it with its reason, and end that reply with one line
  per declined finding: "Declined: <title> — <reason>". The editor runs the review: don't start
  one of your own.
- At the end, say where the result is, each change by its link, at most three things the user
  might not expect, and what you didn't check. No recap of the request, no list of all you did.
- Ask one question at a time, with its options and the one you suggest first.
`;

/**
 * The components (ADR 0041): their files, which system components' look the design owns, and the
 * format an agent writes a component's file in.
 */
const componentsOf = (
  designsDir: string,
  components: readonly ComponentFile[]
) => {
  const looks = components.filter((c) => c.origin === "system");
  return `${componentFiles(designsDir)}
${looks.length > 0 ? `The design owns the look of ${looks.map((c) => c.name).join(", ")} (change a look in its file, not on each instance).\n` : ""}
`;
};

export class ProjectBriefing extends Context.Service<
  ProjectBriefing,
  {
    /**
     * The briefing for the open project, for a thread of this purpose (ADR 0030), or nothing when
     * no project is open. `tools`: its agent has the editor's tools (ADR 0039), the server's MCP
     * setting when it is not said. `system`: its task makes the design system, whose part of the
     * design skill it is told. `designs`: the thread draws designs and is told the design
     * skills; a design thread does unless said otherwise (`drawsDesigns`), an implement thread
     * never.
     */
    readonly text: (
      purpose: ThreadPurpose,
      options?: {
        readonly designs?: boolean;
        readonly system?: boolean;
        readonly tools?: boolean;
      }
    ) => Effect.Effect<string | undefined>;
  }
>()("ultrapaint/server/ProjectBriefing") {
  static readonly layer = Layer.effect(
    ProjectBriefing,
    Effect.gen(function* () {
      const project = yield* OpenProject;
      const { mcp } = yield* ServerConfig;
      const sandbox = yield* AgentSandbox;

      const build = Effect.fnUntraced(function* (
        purpose: ThreadPurpose,
        tools: boolean,
        designs: boolean,
        makesTheSystem: boolean
      ) {
        const ways = agentWays(tools);
        const paths = yield* RepoPaths;
        const pages = yield* (yield* PagesService).list;
        const { settings } = paths;
        // A folder without git has no .git to tell the agent about.
        const gitRepository = yield* (yield* GitService).repository;

        const system = yield* Effect.orElseSucceed(
          Effect.flatMap(DesignSystemService, (service) => service.get),
          () => ({ designSystem: null, document: null })
        );
        const ds = system.designSystem;
        const styles = ds?.typography.styles ?? [];
        const none: SkillsTold = { listed: [], whole: "" };
        const skills = designs
          ? yield* Effect.orElseSucceed(
              Effect.flatMap(SkillsService, (service) =>
                service.briefing(tools, makesTheSystem)
              ),
              () => none
            )
          : none;
        const craft = craftOf(skills);
        const conventions = conventionsOf(system.document);
        const files = yield* Effect.orElseSucceed(
          Effect.flatMap(ComponentService, (service) => service.components),
          (): readonly ComponentFile[] => []
        );
        const catalogue = catalogueOf(files);
        const components = catalogue.slice(0, COMPONENT_LIMIT);
        const more = catalogue.length - components.length;

        return `<ultrapaint>
You are working in Ultrapaint, a design tool. The user sees the designs you change, live, on
its canvas, drawn with Ultrapaint's system components in this design system's tokens and looks.
${roleOf(purpose, settings.designsDir, ways)}
${designs ? `\n${DESIGN_CHAT}` : ""}
${canvasesIn(settings.designsDir)}
${PAGES}
It holds a tree of nodes, each with an id:
- page: the root; lays its children out as a column.
- row, column: flex containers with gap, align (start|center|end|between|around), crossAlign
  (start|center|end|stretch|baseline), wrap, padding.
- group: a plain container; its children stack.
- text: role "heading" (with level 1-6) or "paragraph", its text, and either a textStyle of the
  design system (its size, weight and line height as one thing: prefer this) or its own size,
  weight, lineHeight, font, tracking; and color, align.
- image: src (assets/<file>: the canvas's own assets/ when it has that file, the shared assets/ at the root of the designs directory otherwise; or a URL), alt, fit.
- instance: a component (listed below) — component (its name), from "${SYSTEM_FROM}" for
  Ultrapaint's system components or "${APP_FROM}" for the project's app components, props, and
  text or children. A child names the slot of its component it fills ("slot": "dialog-footer"); the rest fill the default slot. An overlay (Select, Menu,
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
${ds.tokenPreset === "detailed" ? `${DETAILED_NOTE}\n` : ""}${
  styles.length > 0
    ? `Text styles: ${textStylesByGroup(styles)}
`
    : ""
}`
    : `${DEFAULT_LOOK_NOTE}
Design tokens of the default look: ${tokensOf(DEFAULT_LOOK)}
`
}${craft}${conventions}
${
  components.length > 0
    ? `Components you can place, the project's own marked (app), a default slot *${more > 0 ? ` (${more} more: list them with the tools)` : ""}:
${components.map((c) => `- ${componentLine(c)}`).join("\n")}`
    : ""
}

${ways.changingDesigns}

${componentsOf(settings.designsDir, files)}Your shell already starts in ${paths.root}, the repository: use paths relative to it, and
stay inside it. Changes land on the canvas as you make them, so make them one
step at a time rather than rewriting a page wholesale. ultrapaint.config.json is the user's:
never write it; when styles are missing, send the user to Sync in the Design system panel.${dotGitNote(sandbox.available, gitRepository, writesGit(settings))}
</ultrapaint>`;
      });

      return ProjectBriefing.of({
        text: (purpose, options = {}) =>
          project
            .use(
              build(
                purpose,
                options.tools ?? mcp,
                purpose === "design" && options.designs !== false,
                options.system ?? false
              )
            )
            // No project open, or a repository the server cannot read: the agent manages without.
            .pipe(Effect.orElseSucceed(() => undefined)),
      });
    })
  );
}
