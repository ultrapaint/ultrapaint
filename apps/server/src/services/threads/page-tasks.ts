/**
 * The tasks that draw or implement pages: implement a page or a component in the
 * application's code, link pages built already to their code, an uploaded Figma file as pages, a
 * canvas redrawn another way, and a sheet of the design system into a canvas.
 */
import { familyOf } from "@ultrapaint/contracts/canvas-layout";
import {
  APP_FROM,
  type AppComponentFile,
  type ComponentFile,
  componentFileOf,
  SYSTEM_FROM,
  type SystemComponentFile,
} from "@ultrapaint/contracts/components";
import type { TextStyle } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { componentTarget } from "@ultrapaint/contracts/implementation";
import type { Page } from "@ultrapaint/contracts/pages";
import { baselineKey, type TokenDiff } from "@ultrapaint/contracts/sync";
import type {
  ComponentsTask,
  ImplementTask,
  ImportFigmaTask,
  RedrawTask,
} from "@ultrapaint/contracts/tasks";
import { outlineOf, walk } from "@ultrapaint/design-document/tree";
import { plural } from "@ultrapaint/shared/text";
import { Effect } from "effect";
import { ProjectManager } from "../../project.ts";
import { ComponentService } from "../components.ts";
import { DesignSystemService } from "../design-system.ts";
import { DesignTargets } from "../design-targets.ts";
import { DocumentService } from "../documents.ts";
import { FigmaImportService } from "../figma-import.ts";
import { ImplementationService, type Note } from "../implementation.ts";
import { pageEntry, pageNamed } from "../page-names.ts";
import { PagesService } from "../pages.ts";
import { RepoPaths } from "../repo-paths.ts";
import { ProjectStyleSystem } from "../style-system.ts";
import { type AgentWays, handoffCall } from "./agent-ways.ts";
import { needsTools, pageSchema, taskFailure, userAdds } from "./task-text.ts";

const named = (id: string) => JSON.stringify(id);

/** Steps as a task numbers them, a step that does not apply left out. */
const numbered = (steps: readonly (string | null)[]) =>
  steps
    .filter((step): step is string => step !== null)
    .map((step, i) => `${i + 1}. ${step}`)
    .join("\n");

/** A token waiting for the code, a line: the design's value, the code's, and whether both moved. */
const waitingLine = (d: TokenDiff) =>
  `- ${baselineKey(d.name, d.theme)}: design ${d.design ?? "(taken out)"}, code ${d.source ?? "(not declared)"}${d.outcome === "conflict" ? ", changed on both sides" : ""}`;

const unknownCanvas = (
  command: string,
  id: string,
  canvases: readonly { readonly id: string; readonly name: string }[]
) =>
  taskFailure(
    command,
    `there is no canvas ${named(id)}; the canvases are: ${canvases.map((c) => `${c.name} (${named(c.id)})`).join(", ") || "none"}`,
    "Ask which one."
  );

const textStyles = (styles: readonly TextStyle[]) =>
  styles.length > 0
    ? `
Text styles of the design system:
${styles.map((style) => `- ${style.name}: ${JSON.stringify(style)}`).join("\n")}
`
    : "";

/**
 * The pages a list of words names: a canvas's id (`""` for the designs directory's own) names
 * all its pages, anything else one page, by the one rule for page names.
 */
const pagesOf = (
  words: readonly string[],
  canvases: readonly { readonly id: string }[],
  pages: readonly Page[]
) => {
  const picked = new Set<string>();
  const unknown: string[] = [];
  for (const word of words) {
    const page = pageNamed(pages, word);
    if (canvases.some((c) => c.id === word)) {
      for (const p of pages.filter((each) => each.canvas === word)) {
        picked.add(p.id);
      }
    } else if (word !== "" && page._tag === "Found") {
      picked.add(page.page.id);
    } else {
      unknown.push(word === "" ? named(word) : word);
    }
  }
  return { picked, unknown };
};

/** What a system component's implementation is: its look on the application's own component. */
const systemIntro = (
  component: SystemComponentFile,
  notes: readonly Note[]
) => {
  const asked = notes.length > 0;
  return `Implement the look of the ${component.name} system component as its file says (${componentFileOf(component.name)}),
on the application's own ${component.name}: find the component the application uses for it, whatever library it
is written with (Base UI, Radix, shadcn, MUI…), and give each of its parts the look of the matching part,
in each variant and state, as closely as the library allows. Where the application has none, create
it, on Base UI when the application has no library of its own. Its behaviour stays the library's${asked ? ", with what its behaviour notes ask" : ""}.`;
};

/** What an app component's implementation is: a component of the application's, from its tree. */
const appIntro = (
  component: AppComponentFile,
  libraryDirs: readonly string[]
) => `Implement ${component.name}, an app component of the design (${componentFileOf(component.name)}), as a component of
the application, in the components directory (${libraryDirs.join(", ") || "where the application keeps its components"}) and in the shape the
other components have: written from its tree, with a prop for each of its properties and a child or a
named prop for each of its slots. Each system component inside it is the application's own component for it, each
app component inside it the application's component of that name (implement those first).`;

/** How an app component's file reads, for an agent. */
const APP_FORMAT = `The file: \`tree\` is what every instance draws, its root the instance; \`properties\` are what an
instance sets, by name: a text, a boolean (a node shown or not), an image's source, or a choice of
\`members\` whose overrides the tree's nodes keep in \`at\` under "<property>=<member>" beside the
breakpoints'; each property's \`targets\` are the nodes it sets (\`prop\`: a property of the component the
node is). \`slots\` are containers of the tree an instance's children fill (\`default\`: the children that name no slot).`;

/** How a system component's file reads, for an agent. */
const SYSTEM_FORMAT = `The file: \`base\` is what every instance starts from; \`variants\` per prop and value; \`states\`
(hover, focus, active, highlighted, disabled, open, checked, invalid) are the state classes (\`hover:\`,
\`focus-visible:\`, \`active:\` or \`data-active:\`, \`data-highlighted:\`, \`disabled:\`, \`data-open:\` or
\`data-[state=open]:\`, \`data-checked:\`, \`aria-invalid:\`), on the part itself or on the root; a part other
than \`root\` is the element with that \`data-slot\`; \`direction\`, \`align\`, \`crossAlign\` and \`order\` are the
part's flex layout. \`content\` is what a slot holds when an instance gives it nothing, \`hidden\` the
optional parts the component leaves out, and \`item\` what a Select's or a Menu's item draws (\`label\`
and \`image\` the nodes showing the item's). Values are the design system's tokens.`;

/** The components a tree uses, by name. */
const usedComponents = (root: DesignNode | null | undefined) => {
  const used = new Set<string>();
  if (root) {
    for (const node of walk(root)) {
      if (node.type === "instance") {
        used.add(node.component);
      }
    }
  }
  return used;
};

/** Where a page belongs in the application, as the design says it. */
const whereOf = (page: Page) => {
  if (page.state !== undefined) {
    return `It is the ${page.state} state of ${page.name}: implement it as that state of the same screen (what the screen shows when it is ${page.state}), not as a page of its own.`;
  }
  return page.route === undefined
    ? "It has no URL in the design: ask the user where it belongs before writing anything."
    : `It serves ${page.route} in the design's prototype.`;
};

const notesSection = (
  notes: readonly Note[],
  on: "page" | "component" = "page"
) => {
  if (notes.length === 0) {
    return "";
  }
  const where = (n: (typeof notes)[number]) => {
    if (!n.element) {
      return "";
    }
    return n.nodeId ? `on ${n.element} (${n.nodeId}): ` : `on ${n.element}: `;
  };
  return `
Behaviour notes on the ${on}, what the code must do that the design cannot show:
${notes.map((n) => `- ${where(n)}${n.text}`).join("\n")}
`;
};

const statesSection = (states: readonly Page[]) =>
  states.length > 0
    ? `
The page's states, drawn as pages of their own; implement each as a state of this screen:
${states.map((p) => `- ${p.state}: ${p.file}`).join("\n")}
`
    : "";

const ownedSection = (owned: readonly ComponentFile[]) => {
  if (owned.length === 0) {
    return "";
  }
  const looks = owned.filter((c) => c.origin === "system");
  const apps = owned.filter((c) => c.origin === "app");
  return `${
    looks.length > 0
      ? `
System components whose look the design owns (ADR 0041): ${looks.map((c) => c.name).join(", ")}. Use
them as they are; their look is implemented on its own (/implement <Component>), not in this page.`
      : ""
  }${
    apps.length > 0
      ? `
App components (from "${APP_FROM}"): ${apps.map((c) => c.name).join(", ")}. Each is a component of the
application, implemented on its own (/implement <Component>): use it, with its instance's props as its
properties and its children in its slots; one the application does not have yet is implemented first.`
      : ""
  }
`;
};

/**
 * How `/components` draws its sheet: through the tools, or by writing the pages' files, which
 * the user sizes on the canvas.
 */
/** Past this many characters a page's design is given as an outline, read in parts with the tools. */
const DESIGN_INLINE_LIMIT = 40_000;
/** How deep the outline of a page too big to give whole goes. */
const OUTLINE_DEPTH = 3;

/**
 * A page's design as a task gives it: its tree as compact JSON, or, too big for that and with the
 * tools there to read it in parts, its outline and how to read the rest.
 */
const designOf = (
  root: DesignNode | null,
  ways: AgentWays,
  page: Page
): string => {
  const whole = JSON.stringify(root);
  if (!(root && ways.tools && whole.length > DESIGN_INLINE_LIMIT)) {
    return `The design, as the editor holds it:\n${whole}`;
  }
  return `The design is large: its outline, ${OUTLINE_DEPTH} levels down (a node there counts its children). Read each part with ${ways.tools.read_page} (route "${page.file}", node its id) as you write it:
${JSON.stringify(outlineOf(root, OUTLINE_DEPTH))}`;
};

const sheetSteps = (ways: AgentWays, canvas: string, designsDir: string) => {
  const { tools } = ways;
  const create = tools
    ? `Create them with ${tools.create_page} and
   canvas: ${named(canvas)}`
    : `Write each as a .page.json file in ${canvas === "" ? designsDir : `${designsDir}/${canvas}`}`;
  return numbered([
    `Read the design system for each component's category, description and example props
   (${ways.readDesignSystem(designsDir)}), and ${ways.readComponent} for its props and variants.`,
    `One page per category named "Components <category>" ("Components forms"), or one page named
   "Components" when there are fewer than a dozen components. ${create}, without a URL: a sheet is not a screen of the application.`,
    `In a page, per component: its name as a heading and one line on what it is for, in the design
   system's text styles; under them a row that wraps, with one instance for each value of each
   variant prop (a Button in each variant; for two variant props, one row per value of the first).
   Give every instance its example props and text so it draws something, and show the states it
   has (disabled, loading, invalid) where they change how it looks.${tools ? "" : ` The page format: ${pageSchema()}`}`,
    tools
      ? `Size each page's frame with ${tools.set_frame}, 1440 wide and tall enough to show the whole sheet.`
      : null,
    tools
      ? `Look at every page with ${tools.get_screenshot} and fix what is off: overlaps, clipped content,
   instances that draw nothing.`
      : null,
    `End with a short summary: the pages written, and the components you could not draw and why.${tools ? "" : " Tell the user to size each page's frame on the canvas, 1440 wide and tall enough to show the whole sheet."}`,
  ]);
};

export const makePageTasks = Effect.fnUntraced(function* (deps: {
  /** What a task says first when the editor sees no components. */
  readonly ways: AgentWays;
}) {
  const { ways } = deps;
  const project = yield* ProjectManager;

  /**
   * Implement (ADR 0030): a page or a component turned into the application's code. A
   * design implemented before is given with what changed since, its behaviour notes and its
   * states; the agent marks it implemented when it is done.
   */
  const implement = ({ canvas, extra, target }: ImplementTask) =>
    project.use(
      Effect.gen(function* () {
        const designTargets = yield* DesignTargets;
        const design = yield* designTargets
          .resolve(target, canvas)
          .pipe(
            Effect.mapError((miss) =>
              taskFailure("implement", miss.message, "Ask which one.")
            )
          );
        const notes = yield* designTargets.notes(design);
        if (design._tag === "Component") {
          return yield* implementComponent(design.component, notes, extra);
        }
        const { pages } = yield* (yield* PagesService).list;
        const components = yield* (yield* ComponentService).components;
        return yield* implementPage(
          design.page,
          pages,
          components,
          notes,
          extra
        );
      })
    );

  /**
   * Adopt (ADR 0030): pages the application has built already, linked to the files that
   * implement them, without changing the code. What a project brought into the editor with its
   * screens done starts from. Named by nothing, every page that is not linked yet.
   */
  const adopt = (words: readonly string[]) =>
    project.use(
      Effect.gen(function* () {
        const { canvases, pages } = yield* (yield* PagesService).list;
        const { items } = yield* (yield* ImplementationService).list;
        const bound = new Set(
          items
            .filter((i) => i.status === "implemented" || i.status === "changed")
            .map((i) => i.target)
        );
        const { picked, unknown } = pagesOf(words, canvases, pages);
        const chosen = pages.filter(
          (p) => (words.length === 0 || picked.has(p.id)) && !bound.has(p.id)
        );
        if (chosen.length === 0) {
          return yield* taskFailure(
            "implement",
            `${unknown.length > 0 ? `there is no canvas or page ${unknown.join(", ")}, and ` : ""}every page ${words.length > 0 ? "named " : ""}is linked already`,
            "Say so, and stop."
          );
        }
        return adoptTask(chosen, unknown);
      })
    );

  const adoptTask = (chosen: readonly Page[], unknown: readonly string[]) => {
    const { tools } = ways;
    const lines = chosen.map(
      (p) =>
        `- ${p.id}: ${p.name}${p.state ? ` in the ${p.state} state` : ""}${p.variant ? ` (variant ${p.variant})` : ""}, ${p.route ?? "no URL"}`
    );
    return `<ultrapaint-task command="implement">
These pages of the design are built in the application already, and the editor does not know by
which files. Find the code that implements each one and link them, so that from now on the editor
tells what changed on either side. Do not change the application's code, and do not change the
designs.${
      unknown.length > 0
        ? `
(There is no canvas or page ${unknown.join(", ")}; they are left out.)`
        : ""
    }

The pages, by id:
${lines.join("\n")}

${numbered([
  `Find where the application's pages live and how its routes are declared. For each page above,
   find the screen that serves its URL; a page without a URL is matched by its name and what it
   shows. Ask the user where you cannot tell, a few pages at a time.`,
  `Where the code draws the same screen (${tools ? `${tools.read_page} and ${tools.get_screenshot} show the design` : "its file is the design"}; the
   layout, the sections and the components match, not every pixel), ${ways.linkBuilt}`,
  `Where the code draws something else, or nothing, leave the page unlinked: it is a design still
   to implement.`,
  // Marking checks the tokens only through the tool.
  tools
    ? `If marking is refused because tokens the page uses have not reached the code, the design's
   values are newer than the stylesheet's: ask the user whether to export them (${handoffCall("export")}
   and their names) before marking, or to leave the page unlinked.`
    : null,
  "End with a table: each page, the files that implement it or why it is left unlinked.",
])}
</ultrapaint-task>`;
  };

  /**
   * The tokens a design relies on whose value has not reached the code (ADR 0028): listed, with
   * the step that brings them over before the code is written to match the design. The others
   * waiting are other designs' and stay.
   */
  const tokensFor = Effect.fnUntraced(function* (target: string) {
    const { others, used } = yield* Effect.orElseSucceed(
      (yield* ImplementationService).tokens(target),
      () => ({ others: 0, used: [] as readonly TokenDiff[] })
    );
    if (used.length === 0) {
      return { section: "", step: null };
    }
    const conflicted = new Set(
      used.filter((d) => d.outcome === "conflict").map((d) => d.name)
    );
    const plain = [...new Set(used.map((d) => d.name))].filter(
      (name) => !conflicted.has(name)
    );
    const rest =
      others > 0
        ? ` ${plural(others, "other token")} of the design wait for the code too: leave them, they are other designs', unless the user asks.`
        : "";
    const section = `
Tokens this design uses whose value has not reached the code, the design's value first. The
design system holds the values and the stylesheets follow it; until these are brought over, the
code cannot draw the design as it is:
${used.map(waitingLine).join("\n")}
`;
    const ask =
      conflicted.size > 0
        ? ` ${[...conflicted].join(", ")} changed on both sides: ask the user which value to keep, then ${ways.settleTokens}.`
        : "";
    const write = plain.length > 0 ? `${ways.exportTokens(plain)}.` : "";
    return {
      section,
      step: `Bring the tokens above over before writing the code: ${write}${ask}${rest}`,
    };
  });

  /** What was implemented before, and what changed since, for a task to start from. */
  const since = Effect.fnUntraced(function* (target: string) {
    const service = yield* ImplementationService;
    const item = yield* Effect.orElseSucceed(service.item(target), () => null);
    const changes = yield* Effect.orElseSucceed(
      service.changes(target),
      () => null
    );
    if (!(item?.files.length && changes?.implemented)) {
      return "It has not been implemented before.";
    }
    const lines = [
      `It was implemented before, in ${item.files.join(", ")}.`,
      changes.empty
        ? "The design has not changed since: check the code still matches it."
        : `What changed in the design since then:\n${changes.text}\nChange the code for these; what did not change is implemented already.`,
    ];
    if (item.changedFiles.length > 0) {
      lines.push(
        `These files changed since, by someone else: ${item.changedFiles.join(", ")}. Keep what they changed unless the design says otherwise, and tell the user where the code and the design now disagree.`
      );
    }
    return lines.join("\n");
  });

  const implementPage = Effect.fnUntraced(function* (
    page: Page,
    pages: readonly Page[],
    files: readonly ComponentFile[],
    notes: readonly Note[],
    extra: string | undefined
  ) {
    const state = yield* Effect.orElseSucceed(
      (yield* DocumentService).get(page.id),
      () => null
    );
    const { designSystem } = yield* (yield* DesignSystemService).get;
    const { codeRules } = yield* ProjectStyleSystem;
    const styles = designSystem?.typography.styles ?? [];
    const before = yield* since(page.id);
    const states = familyOf(pages, page).filter(
      (p) => p.state !== undefined && p.id !== page.id
    );
    const used = usedComponents(state?.root);
    const owned = files.filter((c) => used.has(c.name));
    const where = whereOf(page);
    const tokens = yield* tokensFor(page.id);
    return `<ultrapaint-task command="implement">
Implement the page ${page.name} of the design (${page.file}) in this repository's application,
in its own conventions. ${where}
The design is what it looks like and which states it has; what it does (data, permissions,
validation, what a button calls) is the code's, and the behaviour notes below say what is wanted.

${before}
${notesSection(notes)}${statesSection(states)}${ownedSection(owned)}${tokens.section}
${designOf(state?.root ?? null, ways, page)}

${codeRules}
${textStyles(styles)}
${numbered([
  `Find where the application's pages live and how its routes are declared${before.startsWith("It was") ? ", starting from the files that implement it" : ""}. If it is not clear
   where this page belongs, ask the user before writing anything.`,
  tokens.step,
  `Write the page with the application's own components and existing layouts; do not copy the
   design node by node where a component already does the job. Each instance is one of
   ultrapaint's system components (from "${SYSTEM_FROM}"): write it as the application's own component
   for it, its slots as that component's parts (a Dialog's "dialog-footer" is its footer), and
   where the application has none, write one in its component library's way.`,
  `Implement each behaviour note with the application's own services, guards and data; ask the
   user where one is unclear rather than inventing it.`,
  "Run the repository's type check and linter on what you changed.",
  `Once it is done, ${ways.markImplemented(named(page.id))}`,
  "End with a short summary, and what the design asked for that the code could not do.",
])}
${userAdds(extra)}</ultrapaint-task>`;
  });

  const implementComponent = Effect.fnUntraced(function* (
    component: ComponentFile,
    notes: readonly Note[],
    extra: string | undefined
  ) {
    const target = componentTarget(component.name);
    const before = yield* since(target);
    const tokens = yield* tokensFor(target);
    const { codeRules } = yield* ProjectStyleSystem;
    const paths = yield* RepoPaths;
    const app = component.origin === "app";
    const intro = app
      ? appIntro(component, paths.settings.libraryDirs)
      : systemIntro(component, notes);
    return `<ultrapaint-task command="implement">
${intro}

${before}
${notesSection(notes, "component")}${tokens.section}
${app ? APP_FORMAT : SYSTEM_FORMAT}
${JSON.stringify(component)}

${codeRules}
${numbered([
  tokens.step,
  app
    ? "Write the component, its props typed by its properties (a choice as a union of its members, its default the property's), and its slots as children or named props."
    : "Change the component's classes (its cva base, variants and sizes, and the state classes) so it draws as the file says. Keep its props and behaviour.",
  notes.length > 0
    ? "Implement each behaviour note in the component, with the application's own services and data; ask the user where one is unclear rather than inventing it."
    : null,
  "Run the repository's type check and linter on what you changed.",
  `Once it is done, ${ways.markImplemented(named(target))}`,
  "End with a short summary, and what the design asked for that the code could not do.",
])}
${userAdds(extra)}</ultrapaint-task>`;
  });

  const importFigma = ({ extra, file }: ImportFigmaTask) =>
    project.use(
      Effect.gen(function* () {
        const figma = yield* FigmaImportService;
        const imports = yield* figma.list;
        const chosen =
          imports.find((i) => i.id === file || i.name === file) ?? imports[0];
        if (!chosen) {
          return yield* taskFailure(
            "import-figma",
            "no Figma file has been uploaded",
            'Tell them to use "Import Figma…" in the Pages panel, which takes a .fig file, and stop.'
          );
        }
        const { tools } = ways;
        if (!tools) {
          return yield* needsTools(
            "import-figma",
            "writing the mapping of a Figma file's components"
          );
        }
        const { designSystem } = yield* (yield* DesignSystemService).get;
        const frames = chosen.pages.flatMap((page) =>
          page.frames.map((f) => `${f.name} (${f.id}, ${f.width}×${f.height})`)
        );
        const components = chosen.components
          .filter((c) => c.uses > 0)
          .sort((a, b) => b.uses - a.uses)
          .map(
            (c) =>
              `- ${c.key}: used ${c.uses}×${
                Object.keys(c.variants).length > 0
                  ? `, variants ${Object.entries(c.variants)
                      .map(([name, values]) => `${name}=${values.join("|")}`)
                      .join(" ")}`
                  : ""
              }${
                c.candidates.length > 0
                  ? `; might be ${c.candidates.map((k) => k.name).join(" or ")}`
                  : "; no system component of a similar name"
              }`
          );
        return `<ultrapaint-task command="import-figma">
Turn the Figma file "${chosen.name}" (import ${chosen.id}) into pages of this project, drawn with
ultrapaint's system components where they fit.

Through the ultrapaint MCP server: ${tools.read_figma_import} (the file: frames, components, candidates, the
mapping so far), ${tools.read_figma_component} and ${tools.read_figma_frame} (one of them, with an outline of its layers),
${tools.map_figma_component} (what a Figma component becomes), ${tools.write_figma_frame} (a frame as a page), ${tools.ask_user}
(a question card for the user), ${tools.list_components} and ${tools.get_component} (ultrapaint's system components).

The file has ${frames.length} frame${frames.length === 1 ? "" : "s"}: ${frames.join(", ") || "none"}.
Its components, most used first:
${components.join("\n") || "- none"}
${chosen.warnings.length > 0 ? `\nWhat the reading could not carry over:\n${chosen.warnings.map((w) => `- ${w}`).join("\n")}\n` : ""}
${
  designSystem
    ? `The design system is imported: ${tools.read_design_system} has its tokens and each component's notes.`
    : `There is no design system yet; components come from ${tools.list_components}. Afterwards, point the user to Sync in the Design system panel, which makes one.`
}

1. Read the import (${tools.read_figma_import}) and the system components (${tools.list_components}). For each Figma
   component, most used first, decide what it becomes:
   - It is one of the system components when the name and the variants say so (a Button with
 Size and Type variants is the Button system component). Read the system component with
 ${tools.get_component} for its props, then map it with ${tools.map_figma_component}: the variants and text
 properties to its props (propMap), constants to props, the label to text.
   - It is custom when nothing here does the job: map it as {kind:"expand"} and its layers are kept.
   - Decorative ones (a status bar, a cursor, a placeholder image) are {kind:"skip"}.
   Where you cannot tell — a candidate that only looks alike, two candidates, a component this
   repository may have under another name — ask the user ${ways.askUser}, up to four components per
   card, each with the candidates as options, "Custom: keep its layers" and "Skip" among them, and
   allowOther for a name you did not think of. Carry on with the answers it returns (if it says the
   questions were shown instead, end your turn; they come as the next message). Do not ask about
   what the names settle.
2. Once every used component is decided, write each frame with ${tools.write_figma_frame}, in the canvas the
   user works in. A screen of the application gets a URL that fits its name ("Login" is /login,
   "Home" is /); a frame that is not a screen (a component sheet, a style guide) gets none, and ask
   whether to import it at all.
3. Look at each page with ${tools.get_screenshot} and mend what the rules got wrong with ${tools.apply_operations}:
   colours the design system has a token for that came through as hex, sizes that should be "fill"
   or "hug", texts that should be set in a text style. Keep the page close to the Figma frame.
4. End with a short summary: the pages written, the mapping, and what to look at by hand.
${userAdds(extra)}</ultrapaint-task>`;
      })
    );

  const redraw = ({ canvas: id, change }: RedrawTask) =>
    project.use(
      Effect.gen(function* () {
        const { canvases, pages } = yield* (yield* PagesService).list;
        const canvas = canvases.find((c) => c.id === id);
        if (!canvas) {
          return yield* unknownCanvas("redraw", id, canvases);
        }
        const own = pages.filter((p) => p.canvas === id);
        const list = own.map((p) => `- ${pageEntry(p)}`).join("\n");
        return `<ultrapaint-task command="redraw">
The canvas "${canvas.name}" (${named(id)}) is a copy the user made to take another way. Change every page of it as
the user asks:
${change || "(the user did not say what to change: ask before changing anything)"}

Its pages:
${list || "- none"}

${ways.editPages(named(id))}

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

  const components = ({ canvas: id, extra }: ComponentsTask) =>
    project.use(
      Effect.gen(function* () {
        const { canvases, pages } = yield* (yield* PagesService).list;
        const canvas = canvases.find((c) => c.id === id);
        if (!canvas) {
          return yield* unknownCanvas("components", id, canvases);
        }
        const catalogue = yield* (yield* ComponentService).catalogue;
        const known = catalogue.map((c) => {
          const variants = Object.entries(c.variants)
            .map(([name, values]) => `${name}=${values.join("|")}`)
            .join(" ");
          return `- ${c.name} (${c.category})${variants ? `: ${variants}` : ""}`;
        });
        const sheets = pages
          .filter(
            (p) =>
              p.canvas === id &&
              (p.name.toLowerCase().startsWith("components") ||
                p.route?.startsWith("/components") === true)
          )
          .map((p) => p.file);
        const { tools } = ways;
        const { designsDir } = (yield* RepoPaths).settings;
        return `<ultrapaint-task command="components">
Draw a sheet of this repository's design system into the canvas "${canvas.name}" (${named(id)}): every component a
designer would place, in each of its variants, so the canvas shows what there is to design with.

The components, with their category and variants:
${known.join("\n") || `- none found${tools ? `: call ${tools.list_components}` : ""}`}
${
  sheets.length > 0
    ? `\nThe canvas has sheets already (${sheets.join(", ")}): bring them up to date rather than drawing them again —
add what is missing, take out what the design system no longer has.\n`
    : ""
}
${sheetSteps(ways, id, designsDir)}
${userAdds(extra)}</ultrapaint-task>`;
      })
    );

  return { adopt, components, implement, importFigma, redraw };
});
