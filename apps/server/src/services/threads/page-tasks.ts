/**
 * The tasks of the commands that draw or implement pages: `/implement` a page in the
 * application's code, `/import-figma` an uploaded file as pages, `/redraw` a canvas another way,
 * and `/components` a sheet of the design system into a canvas.
 */
import type { TextStyle } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  SPEC_TARGET_PREFIX,
  specTarget,
} from "@ultrapaint/contracts/implementation";
import type { Page } from "@ultrapaint/contracts/pages";
import {
  type ComponentSpec,
  SPEC_EXTENSION,
  SPECS_DIR,
} from "@ultrapaint/contracts/specs";
import { walk } from "@ultrapaint/design-document/tree";
import { basePathOf, normaliseRoute } from "@ultrapaint/shared/route";
import { Effect } from "effect";
import { ServerConfig } from "../../config.ts";
import { ProjectManager } from "../../project.ts";
import { CatalogueService } from "../catalogue.ts";
import { DesignSystemService } from "../design-system.ts";
import { DocumentService } from "../documents.ts";
import { FigmaImportService } from "../figma-import.ts";
import { ImplementationService } from "../implementation.ts";
import { PagesService } from "../pages.ts";
import { RepoPaths } from "../repo-paths.ts";
import { SpecService } from "../specs.ts";
import { ProjectStyleSystem } from "../style-system.ts";
import { pageSchema, splitArgument, userAdds } from "./task-text.ts";

const QUOTED_ROOT = '""';

/** A canvas as a command names it: its id, `""` for the designs directory's own. */
const canvasArgument = (argument: string) => {
  const { extra, target } = splitArgument(argument);
  return { extra, id: target === QUOTED_ROOT ? "" : target };
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

/** The spec a command names: `spec:Button`, or the component's name. */
const specNamed = (
  specs: readonly ComponentSpec[],
  target: string
): ComponentSpec | undefined => {
  const name = target.startsWith(SPEC_TARGET_PREFIX)
    ? target.slice(SPEC_TARGET_PREFIX.length)
    : target;
  return name ? specs.find((s) => s.component === name) : undefined;
};

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
    readonly state?: string | undefined;
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
    return pages.find(
      (p) =>
        p.route === route && p.variant === undefined && p.state === undefined
    );
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
  notes: readonly {
    readonly element: string | null;
    readonly nodeId: string | null;
    readonly text: string;
  }[]
) => {
  if (notes.length === 0) {
    return "";
  }
  const on = (n: (typeof notes)[number]) => {
    if (!n.element) {
      return "";
    }
    return n.nodeId ? `on ${n.element} (${n.nodeId}): ` : `on ${n.element}: `;
  };
  return `
Behaviour notes on the page, what the code must do that the design cannot show:
${notes.map((n) => `- ${on(n)}${n.text}`).join("\n")}
`;
};

const statesSection = (states: readonly Page[]) =>
  states.length > 0
    ? `
The page's states, drawn as pages of their own; implement each as a state of this screen:
${states.map((p) => `- ${p.state}: ${p.file}`).join("\n")}
`
    : "";

const ownedSection = (owned: readonly ComponentSpec[]) => {
  if (owned.length === 0) {
    return "";
  }
  const drafts = owned.some((s) => s.draft)
    ? 'A draft component (from "#draft") has no code yet: implement it first, or build its tree inline and tell the user.\n'
    : "";
  return `
Components whose look the design owns (ADR 0029): ${owned.map((s) => s.component).join(", ")}. Use
them as they are; their look is implemented on its own (/implement <Component>), not in this page.
${drafts}`;
};

export const makePageTasks = Effect.fnUntraced(function* (deps: {
  /** What a task says first when the editor sees no components. */
  readonly componentsMissing: Effect.Effect<string>;
}) {
  const { componentsMissing } = deps;
  const project = yield* ProjectManager;
  const { mcp } = yield* ServerConfig;

  /**
   * `/implement` (ADR 0030): a page or a component spec turned into the application's code. A
   * design implemented before is given with what changed since, its behaviour notes and its
   * states; the agent marks it implemented when it is done.
   */
  const implement = (argument: string) =>
    project.use(
      Effect.gen(function* () {
        const { extra, target } = splitArgument(argument);
        const specs = yield* (yield* SpecService).specs;
        const spec = specNamed(specs, target);
        if (spec) {
          return yield* implementSpec(spec, extra);
        }
        const { pages } = yield* (yield* PagesService).list;
        const page = pageNamed(pages, target);
        if (!page) {
          return unknownPage(target, pages);
        }
        return yield* implementPage(page, pages, specs, extra);
      })
    );

  /** How to say the design is done, through the editor's tool or to the user. */
  const markStep = (target: string) =>
    mcp
      ? `Mark it implemented: call handoff with action "mark", target "${target}" and files, every
   repository file you wrote or changed for it. The editor then knows which code implements it,
   and tells the next implementation what changed.`
      : "Tell the user which files implement it, so they can mark it implemented in the editor.";

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
    specs: readonly ComponentSpec[],
    extra: string
  ) {
    const state = yield* Effect.orElseSucceed(
      (yield* DocumentService).get(page.id),
      () => null
    );
    const { designSystem } = yield* (yield* DesignSystemService).get;
    const { codeRules } = yield* ProjectStyleSystem;
    const styles = designSystem?.typography.styles ?? [];
    const notes = yield* (yield* ImplementationService).notes(page);
    const before = yield* since(page.id);
    const base = basePathOf(page.path);
    const states = pages.filter(
      (p) =>
        p.canvas === page.canvas &&
        p.state !== undefined &&
        basePathOf(p.path) === base &&
        p.id !== page.id
    );
    const owned = specs.filter(
      (s) => usedComponents(state?.root).has(s.component) && s.look === "design"
    );
    const where = whereOf(page);
    return `<ultrapaint-task command="implement">
Implement the page ${page.name} of the design (${page.file}) in this repository's application,
in its own conventions. ${where}
The design is what it looks like and which states it has; what it does (data, permissions,
validation, what a button calls) is the code's, and the behaviour notes below say what is wanted.

${before}
${notesSection(notes)}${statesSection(states)}${ownedSection(owned)}
The design, as the editor holds it:
${JSON.stringify(state?.root ?? null, null, 2)}

${codeRules}
${textStyles(styles)}
1. Find where the application's pages live and how its routes are declared${before.startsWith("It was") ? ", starting from the files that implement it" : ""}. If it is not clear
   where this page belongs, ask the user before writing anything.
2. Write the page with the design system's components and the application's existing layouts;
   do not copy the design node by node where a component already does the job.
3. Implement each behaviour note with the application's own services, guards and data; ask the
   user where one is unclear rather than inventing it.
4. Run the repository's type check and linter on what you changed.
5. ${markStep(page.id)}
6. End with a short summary, and what the design asked for that the code could not do.
${userAdds(extra)}</ultrapaint-task>`;
  });

  const implementSpec = Effect.fnUntraced(function* (
    spec: ComponentSpec,
    extra: string
  ) {
    const target = specTarget(spec.component);
    const before = yield* since(target);
    const { codeRules } = yield* ProjectStyleSystem;
    const catalogue = yield* Effect.orElseSucceed(
      (yield* CatalogueService).get(false),
      () => null
    );
    const meta = catalogue?.components.find(
      (c) => c.name === spec.component && c.importFrom === spec.from
    );
    const paths = yield* RepoPaths;
    const intro = spec.draft
      ? `Implement ${spec.component}, a draft component of the design (${SPECS_DIR}/${spec.component}${SPEC_EXTENSION}): the code does not have it
yet. Create it in the components directory (${paths.settings.libraryDirs.join(", ") || "where the application keeps its components"}), from the draft's
tree, with a prop for what varies, in the shape the other components have.`
      : `Implement the look of ${spec.component} as its spec says (${SPECS_DIR}/${spec.component}${SPEC_EXTENSION}), in its code${meta ? ` (${meta.file})` : ""}.
Its behaviour stays as it is: only its classes change.`;
    return `<ultrapaint-task command="implement">
${intro}

${before}

The spec: \`base\` is what every instance starts from; \`variants\` per prop and value; \`states\`
(hover, focus, active, disabled, open, checked, invalid) are the state classes (\`hover:\`,
\`focus-visible:\`, \`active:\`, \`disabled:\`, \`data-open:\` or \`data-[state=open]:\`, \`data-checked:\`,
\`aria-invalid:\`); a slot other than \`root\` is the element with that \`data-slot\`. Values are the
design system's tokens.
${JSON.stringify(spec, null, 2)}

${codeRules}
1. ${spec.draft ? 'Write the component, then replace the draft\'s instances in the pages with it: apply_operations, update from and component of each instance whose from is "#draft".' : "Change the component's classes (its cva base, variants and sizes, and the state classes) so it draws as the spec says. Keep its props and behaviour."}
2. Run the repository's type check and linter on what you changed.
3. ${markStep(target)}
4. End with a short summary, and what the spec asked for that the code could not do.
${userAdds(extra)}</ultrapaint-task>`;
  });

  const importFigma = (argument: string) =>
    project.use(
      Effect.gen(function* () {
        const { extra, target } = splitArgument(argument);
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
    : "There is no design system yet; components come from list_components. Afterwards, point the user to Sync in the Design system panel, which makes one."
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

  return { components, implement, importFigma, redraw };
});
