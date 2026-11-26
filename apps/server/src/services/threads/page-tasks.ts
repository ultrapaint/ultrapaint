/**
 * The tasks that draw or implement pages: implement a page or a component in the
 * application's code, link pages built already to their code, bring pages and components up to
 * date from their code, an uploaded Figma file as pages, and a canvas redrawn another way. The components in every variant and state are the Library's boards
 * (ADR 0045), which no agent draws.
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
import {
  behindItsCode,
  codeChangedSince,
  componentNameOf,
  componentTarget,
  type ImplementationItem,
  implementedFileOf,
  isBound,
  isComponentTarget,
} from "@ultrapaint/contracts/implementation";
import {
  type FrameLayout,
  type Page,
  presetSize,
} from "@ultrapaint/contracts/pages";
import { baselineKey, type TokenDiff } from "@ultrapaint/contracts/sync";
import {
  commandOf,
  type ImplementTask,
  type ImportFigmaTask,
  type RedrawTask,
} from "@ultrapaint/contracts/tasks";
import { nodeLabel, walk } from "@ultrapaint/design-document/tree";
import { plural } from "@ultrapaint/shared/text";
import { Effect, FileSystem, Option } from "effect";
import { OpenProject } from "../../project.ts";
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
import { componentBody } from "./agent-docs.ts";
import { type AgentWays, handoffCall } from "./agent-ways.ts";
import { designsOnly, stackStep } from "./first-implementation.ts";
import {
  needsTools,
  OUTLINE_DEPTH,
  taskFailure,
  treeForAgent,
  userAdds,
  variableOnlyNote,
} from "./task-text.ts";

const named = (id: string) => JSON.stringify(id);

/** Steps as a task numbers them, a step that does not apply left out. */
const numbered = (steps: readonly (string | null)[]) =>
  steps
    .filter((step): step is string => step !== null)
    .map((step, i) => `${i + 1}. ${step}`)
    .join("\n");

/** A token waiting for the code, a line: the design's value, the code's, and whether both moved. */
const waitingLine = (d: TokenDiff) =>
  `- ${baselineKey(d.name, d.theme)}: design ${d.design ?? "(taken out)"}, code ${d.source ?? "(not declared)"}${variableOnlyNote(d)}${d.outcome === "conflict" ? ", changed on both sides" : ""}`;

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

/** A page as a task about several lists it: its id, its name, its state and its URL. */
const pageLine = (p: Page) =>
  `- ${p.id}: ${p.name}${p.state ? ` in the ${p.state} state` : ""}, ${p.route ?? "no URL"}`;

/** What a task says of the names it was given that name no canvas or page. */
const leftOut = (unknown: readonly string[]) =>
  unknown.length > 0
    ? `
(There is no canvas or page ${unknown.join(", ")}; they are left out.)`
    : "";

/** What a task says of the names it was given that name no component. */
/**
 * What a task says of the components a named page places whose code changed, the page itself up
 * to date: not taken here, their own update's (ADR 0122).
 */
const pointedToTheirOwn = (names: readonly string[]) =>
  names.length > 0
    ? `
(A page named is up to date with its own code, but places ${names.join(", ")}, whose code changed: they are ${componentsOwnUpdate(names)}.)`
    : "";

const leftOutComponents = (unknown: readonly string[]) =>
  unknown.length > 0
    ? `
(There is no component ${unknown.join(", ")}; they are left out.)`
    : "";

/**
 * Why a task that takes pages has none to take: the names it did not know, and why the pages it
 * was given, or every page, are left.
 */
const noneLeft = (
  unknown: readonly string[],
  givenNames: boolean,
  why: string
) =>
  `${unknown.length > 0 ? `there is no canvas or page ${unknown.join(", ")}, and ` : ""}every page ${givenNames ? "named " : ""}${why}`;

/** A design's behaviour notes, as the update lists them under it. */
const noteLines = (notes: readonly Note[]) =>
  notes.map(
    (note) =>
      `  Behaviour note${note.element ? ` on ${note.element}${note.nodeId ? ` (${note.nodeId})` : ""}` : ""}: ${note.text}`
  );

/**
 * Why an update named pages or components and has none to take: the names it did not know, that
 * each kind named is up to date (a component never implemented has no code to come from), and
 * where the components the pages place are updated instead (ADR 0122).
 */
const nothingNamedBehind = (asked: {
  readonly components: boolean;
  readonly noSuchComponent: readonly string[];
  readonly ownUpdate: string | null;
  readonly pages: boolean;
  readonly unknown: readonly string[];
}) => {
  const missingNames = [
    asked.unknown.length > 0
      ? `no canvas or page ${asked.unknown.join(", ")}`
      : null,
    asked.noSuchComponent.length > 0
      ? `no component ${asked.noSuchComponent.join(", ")}`
      : null,
  ].filter((part) => part !== null);
  const upToDate = [
    asked.pages ? "every page named is up to date with its code" : null,
    asked.components
      ? "every component named is up to date with its code or was never implemented"
      : null,
  ].filter((part) => part !== null);
  const there =
    missingNames.length > 0
      ? `there is ${missingNames.join(" and ")}, and `
      : "";
  return `${there}${upToDate.join(", and ")}${asked.ownUpdate ? `; ${asked.ownUpdate}` : ""}`;
};

/**
 * Why an update has nothing to take: named by nothing, that every linked design is up to date;
 * named, why each name was left out, and where the pages' changed components are updated instead.
 */
const nothingToUpdate = (
  words: readonly string[],
  taken: ReturnType<typeof pagesToUpdate>,
  components: ReturnType<typeof componentsToUpdate>,
  theirOwn: readonly string[]
) =>
  words.length > 0
    ? nothingNamedBehind({
        components: components.namedComponents.length > 0,
        noSuchComponent: components.noSuchComponent,
        ownUpdate:
          theirOwn.length > 0
            ? `the components ${taken.picked.size === 1 ? "it places" : "they place"} whose code changed are ${componentsOwnUpdate(theirOwn)}`
            : null,
        pages: taken.pageWords.length > 0,
        unknown: taken.unknown,
      })
    : "every page and component linked to its code is up to date with it; a page not linked yet is taken only when it or its canvas is named";

/** How the update looks at a component where the application runs (ADR 0122). */
const SEE_COMPONENT_RUNNING = `Where you can see the running application, in a browser or a view at a width of it, look at
   the component on a screen that uses it, in the variants, sizes and states the screens show.
   Where you can see neither, update the component from the code alone.`;

/** The update of a component, sent on its own: what points a page to it (ADR 0122). */
const componentsOwnUpdate = (names: readonly string[]) =>
  `brought up to date on their own, through their instances: ${commandOf({ _tag: "UpdateFromCode", targets: names.map(componentTarget) })}`;

/**
 * The components a tree places, by name, and those they place in turn: a page follows a change to
 * any of them through its instances.
 */
const placedIn = (
  root: DesignNode | null | undefined,
  files: readonly ComponentFile[]
) => {
  const placed = usedComponents(root);
  for (const name of placed) {
    const file = files.find((c) => c.name === name);
    if (file?.origin === "app") {
      for (const inner of usedComponents(file.tree)) {
        placed.add(inner);
      }
    }
  }
  return placed;
};

/**
 * The pages an update takes (ADR 0115): named by nothing, those whose code changed; named, those
 * behind their code, a base page named taking its states with it and a state named alone staying
 * alone. A state is a page of its own: it is taken when it is behind, and only then.
 */
const pagesToUpdate = (
  words: readonly string[],
  canvases: readonly { readonly id: string }[],
  pages: readonly Page[],
  itemByTarget: ReadonlyMap<string, ImplementationItem>
) => {
  const pageWords = words.filter((w) => !isComponentTarget(w));
  const { picked, unknown } = pagesOf(pageWords, canvases, pages);
  const isNamed = (p: Page) =>
    picked.has(p.id) ||
    (p.state !== undefined &&
      familyOf(pages, p).some(
        (base) => base.state === undefined && picked.has(base.id)
      ));
  const chosen = pages.filter((p) => {
    const item = itemByTarget.get(p.id);
    return words.length === 0
      ? codeChangedSince(item)
      : isNamed(p) && behindItsCode(item);
  });
  return {
    chosen,
    named: pages.filter(isNamed),
    pageWords,
    picked,
    unknown,
  };
};

/**
 * The components an update takes (ADR 0122): those whose code changed since they were
 * implemented, named or, named by nothing, all of them. One never implemented has no code to
 * come from, nor a draft to find the code of.
 */
const componentsToUpdate = (
  words: readonly string[],
  files: readonly ComponentFile[],
  itemByTarget: ReadonlyMap<string, ImplementationItem>
) => {
  const namedComponents = words.filter(isComponentTarget).map(componentNameOf);
  const changed = files.filter((c) =>
    codeChangedSince(itemByTarget.get(componentTarget(c.name)))
  );
  return {
    changed,
    chosen: changed.filter(
      (c) => words.length === 0 || namedComponents.includes(c.name)
    ),
    namedComponents,
    noSuchComponent: namedComponents.filter(
      (name) => !files.some((c) => c.name === name)
    ),
  };
};

/** What an update takes: the kinds of design there are, as its text names them. */
const kindNames = (anyPage: boolean, anyComponent: boolean) => {
  const kinds = (page: string, component: string, joint: string) =>
    [anyPage ? page : null, anyComponent ? component : null]
      .filter((kind) => kind !== null)
      .join(joint);
  return {
    /** `pages`, `components` or `pages and components`. */
    several: kinds("pages", "components", " and "),
    /** `page`, `component` or `page or component`. */
    singular: kinds("page", "component", " or "),
  };
};

/** What an update's steps turn on. */
interface UpdateFlags {
  readonly anyComponent: boolean;
  readonly anyPage: boolean;
  /** A design's own changes since it was implemented: the two sides are reconciled. */
  readonly bothChanged: boolean;
  /** The kinds taken, as one of them is named: `page`, `component`, `page or component`. */
  readonly singular: string;
  /** A page is not linked to its code yet: its files are found first. */
  readonly unlinked: boolean;
}

/** The components an update takes (ADR 0122), and how their files read. */
const componentsSection = (
  components: readonly ComponentFile[],
  entries: readonly string[]
) => {
  if (components.length === 0) {
    return "";
  }
  const origins = [...new Set(components.map((c) => c.origin))];
  return `
The components:
${entries.join("\n")}

${origins.map((origin) => `A component's file, of ${componentBody(origin)}`).join("\n")}
`;
};

/** How the update finds the screen that draws a page not linked yet (ADR 0115). */
const FIND_THE_SCREEN = `Find where the application's pages live and how its routes are declared, and the screen
   that serves each page's URL; a page without a URL is matched by its name and what it shows.
   Ask the user where you cannot tell, a few pages at a time.`;

/**
 * The widths a page is drawn at: its frame's, then its views'. A page the canvas has no frame
 * for yet is drawn at the desktop size, as its picture is.
 */
const widthsOf = (frame: FrameLayout | undefined) =>
  frame
    ? [frame.width, ...(frame.views ?? []).map((v) => v.width)]
    : [presetSize.desktop.width];

/** The nodes of a page that lead somewhere in the prototype, and where. */
const linksOf = (root: DesignNode | null | undefined) =>
  root
    ? [...walk(root)].flatMap((node) =>
        "link" in node && typeof node.link === "string"
          ? [`${nodeLabel(node)} (${node.id}) → ${node.link}`]
          : []
      )
    : [];

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

/** How a component's file reads, for an agent that implements it: the code's names for a look's. */
const formatOf = (origin: "system" | "app") =>
  origin === "app"
    ? `The file, of ${componentBody("app")}`
    : `The file, of ${componentBody("system")}
In the code, a state is its state class (\`hover:\`, \`focus-visible:\`, \`active:\` or \`data-active:\`,
\`data-highlighted:\`, \`disabled:\`, \`data-open:\` or \`data-[state=open]:\`, \`data-checked:\`, \`aria-invalid:\`),
on the part itself or on the root, and disabled wins over every other state; a part other than
root is the element with that \`data-slot\`, its direction, align, crossAlign and order its flex
layout. Values are the design system's tokens, or CSS over their variables (a hover's \`color-mix()\`).`;

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
properties and its children in its slots; one the application does not have yet is implemented first.
An instance's \`overrides\` (ADR 0114) change its component's layers for it alone: give the component a
prop for each field they change, named for the layer and the field (\`side fill\` as \`sideFill\`), and
pass the instance's value.`
      : ""
  }
`;
};

/**
 * A page's design as a task gives it, as `read_page` does (`treeForAgent`): its tree as compact
 * JSON, or, too big for that and with the tools there to read it in parts, its outline and how to
 * read the rest.
 */
const designOf = (
  root: DesignNode | null,
  ways: AgentWays,
  page: Page
): string => {
  const shown = root && ways.tools ? treeForAgent(root) : null;
  if (!(shown?.outlined && ways.tools)) {
    return `The design, as the editor holds it:\n${JSON.stringify(root)}`;
  }
  return `The design is large: its outline, ${OUTLINE_DEPTH} levels down (a node there counts its children). Read each part with ${ways.tools.read_page} (route "${page.file}", node its id) as you write it:
${JSON.stringify(shown.tree)}`;
};

export const makePageTasks = Effect.fnUntraced(function* (deps: {
  readonly ways: AgentWays;
}) {
  const { ways } = deps;
  const project = yield* OpenProject;
  const { tools } = ways;

  /** What a design refused a mark is to do: marking checks the tokens only through the tool. */
  const markRefused = tools
    ? `If marking is refused because tokens the design uses have not reached the code, the design's
   values are newer than the stylesheet's: ask the user whether to export them (${handoffCall("export")}
   and their names) before marking, or to leave it unlinked.`
    : null;
  const fs = yield* FileSystem.FileSystem;

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
            noneLeft(unknown, words.length > 0, "is linked already"),
            "Say so, and stop."
          );
        }
        return adoptTask(chosen, unknown);
      })
    );

  const adoptTask = (chosen: readonly Page[], unknown: readonly string[]) => {
    const lines = chosen.map(pageLine);
    return `<ultrapaint-task command="implement">
These pages of the design are built in the application already, and the editor does not know by
which files. Find the code that implements each one and link them, so that from now on the editor
tells what changed on either side. Do not change the application's code, and do not change the
designs.${leftOut(unknown)}

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
  markRefused,
  "End with a table: each page, the files that implement it or why it is left unlinked.",
])}
</ultrapaint-task>`;
  };

  /**
   * Update from code (ADR 0115): pages brought up to date from the code that draws them, each
   * rewritten in place and linked to its files again; a page not linked yet has its files found
   * first. Named by nothing, every page whose code changed: a page not linked yet is taken only
   * when it, or its canvas, is named, since every draft not built yet is unlinked too (decided
   * with the person, 2026-11-23). One up to date with its code is left out. A component
   * (`component:<Name>`) is taken when its code changed since it was implemented, and named by
   * nothing too (ADR 0122); the pages that place it follow through their instances.
   */
  const updateFromCode = (words: readonly string[]) =>
    project.use(
      Effect.gen(function* () {
        const { canvases, pages } = yield* (yield* PagesService).list;
        const { items } = yield* (yield* ImplementationService).list;
        const files = yield* (yield* ComponentService).components;
        const itemByTarget = new Map(items.map((i) => [i.target, i]));
        const taken = pagesToUpdate(words, canvases, pages, itemByTarget);
        const components = componentsToUpdate(words, files, itemByTarget);
        // What each page places, read only when a component's code changed.
        const placedByPage =
          components.changed.length > 0
            ? yield* placingOf(pages, files)
            : new Map<string, ReadonlySet<string>>();
        // The components a named page up to date with its own code places whose code changed, and
        // that are not taken here: their own update's, pointed to whether or not anything is taken.
        const chosenIds = new Set(taken.chosen.map((p) => p.id));
        const chosenComponents = new Set(components.chosen.map((c) => c.name));
        const theirOwn = components.changed
          .filter(
            (c) =>
              !chosenComponents.has(c.name) &&
              taken.named.some(
                (p) =>
                  !chosenIds.has(p.id) && placedByPage.get(p.id)?.has(c.name)
              )
          )
          .map((c) => c.name);
        if (taken.chosen.length === 0 && components.chosen.length === 0) {
          return yield* taskFailure(
            "update-from-code",
            nothingToUpdate(words, taken, components, theirOwn),
            "Say so, and stop."
          );
        }
        const entries = yield* Effect.forEach(taken.chosen, (page) =>
          behindEntry(page, pages, itemByTarget.get(page.id))
        );
        const componentEntries = yield* Effect.forEach(
          components.chosen,
          (component) =>
            componentEntry(
              component,
              itemByTarget.get(componentTarget(component.name)),
              pages.filter((p) => placedByPage.get(p.id)?.has(component.name))
            )
        );
        return updateTask({
          bothChanged: [
            ...taken.chosen.map((p) => p.id),
            ...components.chosen.map((c) => componentTarget(c.name)),
          ].some((target) => itemByTarget.get(target)?.designChanged === true),
          componentEntries,
          components: components.chosen,
          entries,
          noSuchComponent: components.noSuchComponent,
          pages: taken.chosen,
          theirOwn,
          unknown: taken.unknown,
          unlinked: taken.chosen.some(
            (p) => !isBound(itemByTarget.get(p.id)?.status)
          ),
        });
      })
    );

  /** The components each page places, through other app components too, by page id. */
  const placingOf = Effect.fnUntraced(function* (
    pages: readonly Page[],
    files: readonly ComponentFile[]
  ) {
    const documents = yield* DocumentService;
    const placed = new Map<string, ReadonlySet<string>>();
    for (const page of pages) {
      // A page that can't be read places nothing the update can name.
      const doc = yield* Effect.orElseSucceed(
        documents.get(page.id),
        () => null
      );
      placed.set(page.id, placedIn(doc?.root, files));
    }
    return placed;
  });

  /**
   * What the update says of a linked page's code: when and where it was implemented, what changed
   * since, the design as it was implemented, and, when the design changed too, what changed in it
   * for the agent to reconcile with the code's changes.
   */
  const boundLines = Effect.fnUntraced(function* (
    target: string,
    item: ImplementationItem
  ) {
    const { settings } = yield* RepoPaths;
    const on =
      item.at === undefined
        ? ""
        : ` on ${new Date(item.at).toISOString().slice(0, 10)}`;
    const lines = [
      `  It was implemented${on} in ${item.files.join(", ")}. These files changed since: ${item.changedFiles.join(", ")}.`,
      `  The design as it was implemented: ${settings.designsDir}/${implementedFileOf(target)}.`,
    ];
    if (item.designChanged) {
      // What changed in the design is shown when it can be read; the task stands without it.
      const changes = yield* Effect.orElseSucceed(
        (yield* ImplementationService).changes(target),
        () => null
      );
      lines.push(
        `  The design changed since it was implemented too, and those changes never reached the code: reconcile them with the code's, as the steps say.${changes?.text ? `\n  What changed in the design:\n${changes.text.replace(/^/gm, "  ")}` : ""}`
      );
    }
    return lines;
  });

  /**
   * A page behind its code, as the update lists it: what draws it and what changed, the widths it
   * is drawn at, and what it keeps (its states, links and behaviour notes).
   */
  const behindEntry = Effect.fnUntraced(function* (
    page: Page,
    pages: readonly Page[],
    item: ImplementationItem | undefined
  ) {
    const notes = yield* (yield* DesignTargets).notes({ _tag: "Page", page });
    // A canvas whose layout can't be read has no frames: its pages are drawn at the desktop size.
    const layout = yield* Effect.option(
      (yield* PagesService).readCanvas(page.canvas)
    );
    const widths = widthsOf(Option.getOrUndefined(layout)?.frames[page.path]);
    // A page that can't be read lists no links; the agent reads the page itself.
    const doc = yield* Effect.orElseSucceed(
      (yield* DocumentService).get(page.id),
      () => null
    );
    const lines = [
      pageLine(page),
      `  Its file: ${page.file}.`,
      ...(item && isBound(item.status)
        ? yield* boundLines(page.id, item)
        : ["  It is not linked to its code yet."]),
    ];
    lines.push(`  It is drawn at ${widths.join(", ")} px wide.`);
    // A base page names its states; a state named alone names no siblings, which it does not own.
    const states =
      page.state === undefined
        ? familyOf(pages, page).filter((p) => p.state !== undefined)
        : [];
    if (states.length > 0) {
      lines.push(
        `  Its states, drawn as pages of their own and listed here on their own where they are behind too: ${states.map((p) => `${p.state} (${p.id})`).join(", ")}.`
      );
    }
    const links = linksOf(doc?.root);
    if (links.length > 0) {
      lines.push(`  Its links: ${links.join("; ")}.`);
    }
    lines.push(...noteLines(notes));
    return lines.join("\n");
  });

  /**
   * A component behind its code, as the update lists it (ADR 0122): its file, what draws it and
   * what changed, the pages that place it, which follow it, and its behaviour notes.
   */
  const componentEntry = Effect.fnUntraced(function* (
    component: ComponentFile,
    item: ImplementationItem | undefined,
    placers: readonly Page[]
  ) {
    const { settings } = yield* RepoPaths;
    const target = componentTarget(component.name);
    const notes = yield* (yield* DesignTargets).notes({
      _tag: "Component",
      component,
    });
    const lines = [
      `- ${target}: ${component.name}, ${component.origin === "app" ? "an app component" : "a system component's look"} (${settings.designsDir}/${componentFileOf(component.name)})`,
      ...(item ? yield* boundLines(target, item) : []),
      placers.length > 0
        ? `  The pages that place it, which follow it through their instances: ${placers.map((p) => p.id).join(", ")}.`
        : "  No page places it.",
      ...noteLines(notes),
    ];
    return lines.join("\n");
  });

  /**
   * How the update reads what moved, and on which side (ADR 0115, 0122): the code first, the
   * running application where the agent can see it, and the design's own changes beside the
   * code's.
   */
  const readingSteps = (flags: UpdateFlags) => {
    const { anyComponent, anyPage, bothChanged, singular, unlinked } = flags;
    return [
      unlinked
        ? `For each page not linked yet, find the code that draws it. ${FIND_THE_SCREEN}`
        : null,
      `Read the files that draw each ${singular}, starting with the files that changed since it was
   implemented, and the design as it was implemented, to see what moved and what still holds.`,
      anyPage ? ways.seeRunningScreen : null,
      anyComponent ? SEE_COMPONENT_RUNNING : null,
      bothChanged
        ? `For each ${singular} whose design changed too, never take one side whole: set the design's changes
   since it was implemented (listed with it) beside the code's, the git history of its files since
   that day (git log and git diff from then). A change only one side made is kept. Where both
   changed the same thing, the history decides what is current: which change came later, and
   what its commit, or the design's note, says it was for. Where you cannot tell, ask the user
   ${ways.askUser}, a few at a time, before you write. Drop neither side without saying so.`
        : null,
    ];
  };

  /** How the update rewrites each design, and links it to its code again. */
  const writingSteps = ({ anyComponent, anyPage }: UpdateFlags) => [
    anyPage
      ? `Rewrite each page in place to show what the code draws now: the same page and the same URL,
   the ids of the nodes you keep, its states, its links to other pages and its behaviour notes
   where they still hold. Draw with the design system's components and tokens, each of the
   application's components as the component of the design that stands for it. A state listed
   with its page but not on its own is up to date: leave it.`
      : null,
    anyComponent
      ? `Change each component in place to what its code draws now: the same component and name, its
   properties, variants, sizes and slots as the code has them, and its behaviour notes where they
   still hold. Its pages are not rewritten: they follow it through their instances.`
      : null,
    anyComponent ? ways.changeComponent : null,
    anyPage
      ? `Where no code draws a page (an exploration, a board of options), leave it as it is, unlinked,
   and name it in your last message.`
      : null,
    anyPage ? `Once a page is up to date, ${ways.linkBuilt}` : null,
    anyComponent
      ? `Once a component is up to date, ${ways.linkComponent}`
      : null,
    markRefused,
  ];

  /** What the update puts back of the design, and what its last message says. */
  const closingSteps = ({
    anyComponent,
    anyPage,
    bothChanged,
    singular,
  }: UpdateFlags) => {
    const rows = [
      anyPage
        ? "each page, what you changed and the files that draw it, or why it is left as it is"
        : null,
      anyComponent
        ? "each component, what you changed, the files that draw it and the pages that place it, which now draw it as it is"
        : null,
    ].filter((row) => row !== null);
    return [
      bothChanged
        ? `Then, on each ${singular} whose design changed too, put back the design's changes you kept: it
   then reads Design changed, and implementing it builds what is left.`
        : null,
      `End with a table: ${rows.join("; ")}; for a ${singular} whose design changed too, which of its changes you kept for the code to
   follow and which the code had already overtaken, and what the user decided. Say whether you saw the running screen; where you could not see the running screen,
   say so: it was updated from the code alone and not checked against the application.`,
    ];
  };

  /** The pages an update takes, and how they are read and changed. */
  const pagesSection = (pages: readonly Page[], entries: readonly string[]) => {
    if (pages.length === 0) {
      return "";
    }
    const canvasIds = [...new Set(pages.map((p) => p.canvas))];
    const [onlyCanvas] = canvasIds;
    const canvas =
      onlyCanvas !== undefined && canvasIds.length === 1
        ? named(onlyCanvas)
        : `each page's own (${canvasIds.map(named).join(", ")})`;
    return `
The pages, by id:
${entries.join("\n")}

${ways.editPages(canvas)}
`;
  };

  const updateTask = (update: {
    /** A design's own changes since it was implemented: the two sides are reconciled. */
    readonly bothChanged: boolean;
    readonly componentEntries: readonly string[];
    /** The components taken (ADR 0122). */
    readonly components: readonly ComponentFile[];
    readonly entries: readonly string[];
    readonly noSuchComponent: readonly string[];
    /** The pages taken. */
    readonly pages: readonly Page[];
    /** Components named pages up to date with their own code place, whose code changed (ADR 0122). */
    readonly theirOwn: readonly string[];
    readonly unknown: readonly string[];
    /** A page is not linked to its code yet: its files are found first. */
    readonly unlinked: boolean;
  }) => {
    const anyPage = update.pages.length > 0;
    const anyComponent = update.components.length > 0;
    const { several, singular } = kindNames(anyPage, anyComponent);
    const flags: UpdateFlags = {
      anyComponent,
      anyPage,
      bothChanged: update.bothChanged,
      singular,
      unlinked: update.unlinked,
    };
    return `<ultrapaint-task command="update-from-code">
These ${several} of the design have fallen behind the application's code${anyPage ? ", or were never linked to it" : ""}.
Bring each one up to date: rewrite it in place to show what the code draws now, and link it to
the files that draw it. Change the designs only, never the application's code. Each ${singular}'s
version from before stays in the designs' history, where the user can restore it.${leftOut(update.unknown)}${leftOutComponents(update.noSuchComponent)}${pointedToTheirOwn(update.theirOwn)}
${pagesSection(update.pages, update.entries)}${componentsSection(update.components, update.componentEntries)}
${numbered([...readingSteps(flags), ...writingSteps(flags), ...closingSteps(flags)])}
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
    const stack = (yield* designsOnly(fs)) ? stackStep(designSystem, ways) : "";
    return `<ultrapaint-task command="implement">
${stack}Implement the page ${page.name} of the design (${page.file}) in this repository's application,
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
   design node by node where a component already does the job. Each instance of a system
   component (from "${SYSTEM_FROM}") is written as the application's own component
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
${formatOf(component.origin)}
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
            'Tell them to use "Import a Figma file…" under the canvases, which takes a .fig file, and stop.'
          );
        }
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
Ultrapaint's system components where they fit.

Through the ultrapaint MCP server: ${tools.read_figma_import} (the file: frames, components, candidates, the
mapping so far), ${tools.read_figma_component} and ${tools.read_figma_frame} (one of them, with an outline of its layers),
${tools.map_figma_component} (what a Figma component becomes), ${tools.write_figma_frame} (a frame as a page), ${tools.ask_user}
(a question card for the user), ${tools.list_components} and ${tools.get_component} (the components a design places).

The file has ${frames.length} frame${frames.length === 1 ? "" : "s"}: ${frames.join(", ") || "none"}.
Its components, most used first:
${components.join("\n") || "- none"}
${chosen.warnings.length > 0 ? `\nWhat the reading could not carry over:\n${chosen.warnings.map((w) => `- ${w}`).join("\n")}\n` : ""}
${
  designSystem
    ? `The design system is imported: ${tools.read_design_system} has its tokens.`
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
   design may have under another name — ask the user ${ways.askUser}, up to four components per
   card, each with the candidates as options and "Custom: keep its layers" and "Skip" among them;
   the user may type a name you did not think of. Carry on with the answers it returns (if it says the
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

  return { adopt, implement, importFigma, redraw, updateFromCode };
});
