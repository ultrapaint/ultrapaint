import {
  COMPONENT_DOC_PREFIX,
  componentDocOf,
  componentFileOf,
} from "@ultrapaint/contracts/components";
import type { Page } from "@ultrapaint/contracts/pages";
import {
  targetOfRef,
  type VariationTarget,
} from "@ultrapaint/contracts/variations";
import { canvasDocOf } from "@ultrapaint/design-document/tree";
import { parseEditorLink, parseNodeRef } from "@ultrapaint/shared/node-ref";
import { humanise } from "@ultrapaint/shared/path";
import { suffixOf } from "@ultrapaint/shared/route";
import { systemComponentOf } from "@ultrapaint/system-components/catalogue";
import { Effect } from "effect";
import { OpenProject } from "../../project.ts";
import { ComponentService } from "../components.ts";
import { DocumentService } from "../documents.ts";
import { IN_CANVAS_RE, pageMissed, pageTargetNamed } from "../page-names.ts";
import { PagesService } from "../pages.ts";
import { RepoPaths } from "../repo-paths.ts";
import { VariationRounds } from "../variation-rounds.ts";
import { missing, reported } from "./tool-helpers.ts";

/**
 * Where a tool works: a page, or the nodes beside a canvas's pages, maybe one node of either; for
 * the tools that edit a tree, an app component's too (UP-230).
 */
export interface Where {
  /** The canvas; `""` for an app component's tree, which is no canvas's. */
  readonly canvas: string;
  /** The document: the page's id, the canvas's own (`canvasDocOf`), or `component:<Name>`. */
  readonly doc: string;
  /** Its file, repository-relative: the page's, the canvas's `canvas.json`, the component's. */
  readonly file: string;
  /** A node id, never a reference: the one `node` or the name's reference says. */
  readonly nodeId?: string;
  /** Null for the nodes beside the pages. */
  readonly page: Page | null;
  /**
   * The thing whose take this is, when the page is an agent's working copy (ADR 0098): the
   * canvas shows the work on the thing, and renaming the copy hands the take in.
   */
  readonly takeOf?: VariationTarget;
}

/** Where to work, as the parameters of every tool that takes it say it. */
export interface Given {
  readonly canvas?: string | undefined;
  /** The nodes beside the pages, rather than a page. */
  readonly loose?: boolean | undefined;
  /** A node id, or a node reference, which names its page as well. */
  readonly node?: string | undefined;
  /** A page's URL or file, a node reference, or `canvas#id` for a node beside the pages. */
  readonly route?: string | undefined;
}

/**
 * An app component's tree as a tool names it, maybe one node of it: `component:AppShell#nav`. The
 * name as a component's is written, so a page of a canvas named "component" (`component:/home`,
 * `component:home.page.json`) is still that page.
 */
const COMPONENT_REF_RE = new RegExp(
  String.raw`^${COMPONENT_DOC_PREFIX}([A-Za-z][A-Za-z0-9]*)(?:#([\w-]+))?$`
);

/** The app component and maybe the node `component:<Name>` or `component:<Name>#id` names. */
export const componentRefOf = (text: string) => {
  // Typed by hand: the linter otherwise takes the match for non-null.
  const found: RegExpExecArray | null = COMPONENT_REF_RE.exec(text.trim());
  if (found === null) {
    return null;
  }
  const [, name = "", nodeId] = found;
  return { name, nodeId };
};

/** What a tool's `route` names, or else its `node` when that is a reference. */
const namedBy = ({ node, route }: Given) =>
  route ??
  (node !== undefined && (parseNodeRef(node) ?? componentRefOf(node))
    ? node
    : undefined);

/** The node id a reference such as `/home#c_1` or `component:Nav#c_1` stands for; any other text as it is. */
export const nodeIdOf = (text: string) =>
  parseNodeRef(text)?.nodeId ?? componentRefOf(text)?.nodeId ?? text;

/**
 * How a tool finds what an agent names: a canvas, where to work (`where`: a page or the nodes
 * beside the pages, and a node of either), a document. Every miss is a sentence that says what
 * there is instead.
 */
export const makeLookup = Effect.gen(function* () {
  const project = yield* OpenProject;

  const pagesOf = project.use(Effect.flatMap(PagesService, (p) => p.list));

  /** A canvas's id as an agent would pass it back: the designs directory's own is `""`. */
  const quoted = (id: string) => JSON.stringify(id);

  /**
   * The canvas a tool was told to work in, or the only one there is. With several and none
   * named, the tool says so rather than pick one: the first is not what the agent meant.
   */
  const canvasOf = Effect.fnUntraced(function* (canvas: string | undefined) {
    const { canvases } = yield* reported(pagesOf);
    const ids = canvases.map((s) => quoted(s.id)).join(", ");
    if (canvas !== undefined) {
      return canvases.some((s) => s.id === canvas)
        ? canvas
        : yield* missing(
            `no canvas ${quoted(canvas)}; the canvases are ${ids}`
          );
    }
    if (canvases.length <= 1) {
      return canvases[0]?.id ?? "";
    }
    return yield* missing(
      `this project has several canvases (${ids}); say which with \`canvas\``
    );
  });

  /** The nodes beside a canvas's pages, maybe one of them. */
  const beside = Effect.fnUntraced(function* (
    canvas: string | undefined,
    nodeId: string | undefined
  ) {
    const id = yield* canvasOf(canvas);
    const paths = yield* reported(project.use(RepoPaths));
    return {
      canvas: id,
      doc: canvasDocOf(id),
      file: paths.relative(
        `${paths.designsDir}/${id === "" ? "" : `${id}/`}canvas.json`
      ),
      page: null,
      ...(nodeId !== undefined && { nodeId }),
    } satisfies Where;
  });

  /**
   * An app component's tree, maybe one node of it (UP-230). A system component has no tree, and
   * a file that does not read cannot be edited: each is refused with why.
   */
  const treeOf = Effect.fnUntraced(function* (
    name: string,
    nodeId: string | undefined
  ) {
    if (systemComponentOf(name)) {
      return yield* missing(
        `${name} is a system component, which has no tree: change its look with handoff's change, target component:${name}`
      );
    }
    const { components } = yield* reported(
      project.use(Effect.flatMap(ComponentService, (c) => c.list))
    );
    const file = componentFileOf(name);
    const entry = components.find((e) => e.file === file);
    if (entry?.problem !== undefined) {
      return yield* missing(`${file} does not read: ${entry.problem}`);
    }
    if (entry?.component?.origin !== "app") {
      const apps = components.flatMap((e) =>
        e.component?.origin === "app" ? [e.component.name] : []
      );
      return yield* missing(
        `no app component ${name}; ${apps.length > 0 ? `the app components are ${apps.join(", ")}` : "make one of a page's nodes with makeComponent"}`
      );
    }
    const paths = yield* reported(project.use(RepoPaths));
    return {
      canvas: "",
      doc: componentDocOf(name),
      file: paths.relative(`${paths.designsDir}/${file}`),
      page: null,
      ...(nodeId !== undefined && { nodeId }),
    } satisfies Where;
  });

  /** A page, maybe one node of it. */
  const onPage = (page: Page, nodeId: string | undefined): Where => ({
    canvas: page.canvas,
    doc: page.id,
    file: page.file,
    page,
    ...(nodeId !== undefined && { nodeId }),
  });

  /**
   * Where a tool works when it names an agent's working copy (ADR 0098), by its file and maybe a
   * node of it (`file#c_1`); null when it names none.
   */
  const copyAt = (named: string, nodeId: string | undefined) => {
    const ref = targetOfRef(named);
    const file = ref?.doc ?? named;
    return reported(
      project.use(
        Effect.map(VariationRounds, (rounds) => rounds.copyNamed(file))
      )
    ).pipe(
      Effect.map((copy): Where | null =>
        copy === null
          ? null
          : {
              ...onPage(copy.page, nodeId ?? ref?.node),
              takeOf: copy.target,
            }
      )
    );
  };

  /**
   * A name for a page variant from before ADR 0098, a variation of its page now: a link's
   * `variant=` or a reference to its file. The tools work on a page as its variations in use draw
   * it, so it is refused with why, rather than read as the page in use.
   */
  const refuseVariation = Effect.fnUntraced(function* (
    named: string,
    canvas: string | undefined
  ) {
    const link = parseEditorLink(named);
    const ref = link ? null : parseNodeRef(named);
    const inCanvas = link || ref ? null : IN_CANVAS_RE.exec(named.trim());
    // The file a link (`page=`) or a reference names, and the canvas it is in, when it says one
    // (`marketing:home@empty.page.json`).
    const file = link
      ? link.page
      : (ref?.page ?? inCanvas?.[2] ?? named.trim());
    const scope = canvas ?? link?.canvas ?? ref?.canvas ?? inCanvas?.[1];
    const suffix = file === null ? null : suffixOf(file);
    let variant = link?.variant ?? null;
    if (variant === null && file !== null && suffix !== null) {
      // A state's own file is a page of its canvas: only one listed there is let through.
      const { pages } = yield* reported(pagesOf);
      const listed = pages.some(
        (p) =>
          (scope === undefined || p.canvas === scope) &&
          (p.id === file || p.file === file || p.path === file)
      );
      variant = listed ? null : suffix;
    }
    if (variant !== null) {
      return yield* missing(
        `${named} names ${humanise(variant)}, a variation of its page now (ADR 0098); the tools work on the page as its variation in use draws it: name the page itself, and the person puts ${humanise(variant)} in use to change that one`
      );
    }
  });

  /** The page a name means, or the node beside the pages its reference does; a miss says why. */
  const targetNamed = Effect.fnUntraced(function* (
    named: string,
    canvas: string | undefined
  ) {
    const { pages } = yield* reported(pagesOf);
    const found = pageTargetNamed(pages, named, canvas);
    return found._tag === "Page" || found._tag === "Loose"
      ? found
      : yield* missing(pageMissed(pages, found, named, canvas));
  });

  /**
   * Where a tool works, by one rule for every tool (ADR 0018: a node reference is taken wherever
   * a page or a node id is). `route` names a page by URL or by file, in the canvas named or in
   * the only canvas that has it (`pageTargetNamed`), a canvas written first
   * (`marketing:/pricing`); a node reference names its page and its node (`/orders#c_1`), or a
   * node beside the pages (`canvas#c_1`). `node` names a node by id or by reference, and its
   * reference names the page too when `route` does not. `loose: true` is the nodes beside the
   * pages of the canvas named, or of the page's. A miss says it as a design target's does, the
   * pages listed. `component:<Name>` (`component:Nav#c_1`) is an app component's tree, for the
   * tools that edit a tree (`treeWhere`); the others refuse it with why.
   */
  const whereIn = Effect.fnUntraced(function* (given: Given) {
    const { canvas, loose, node } = given;
    const nodeId = node === undefined ? undefined : nodeIdOf(node);
    const named = namedBy(given);
    if (named === undefined) {
      return loose
        ? yield* beside(canvas, nodeId)
        : yield* missing(
            "say which page with `route`, or pass `loose: true` for the nodes beside the pages"
          );
    }
    if (componentRefOf(named) !== null) {
      return yield* missing(
        `${named} is an app component's tree, which read_page and apply_operations work on; to see it drawn, name a page that places it`
      );
    }
    const copy = yield* copyAt(named, nodeId);
    if (copy !== null) {
      return copy;
    }
    yield* refuseVariation(named, canvas);
    const found = yield* targetNamed(named, canvas);
    if (found._tag === "Loose") {
      return yield* beside(canvas ?? found.canvas, nodeId ?? found.nodeId);
    }
    const { page } = found;
    const id = nodeId ?? found.nodeId;
    return loose ? yield* beside(page.canvas, id) : onPage(page, id);
  });

  // Its answers widened to `Where`, which a working copy's `takeOf` is part of.
  const where = (given: Given) => Effect.map(whereIn(given), (at): Where => at);

  /** `where`, or an app component's tree (UP-230): for the tools that read and edit a tree. */
  const treeWhere = (given: Given) => {
    const named = namedBy(given);
    const tree = named === undefined ? null : componentRefOf(named);
    const { node } = given;
    return tree === null
      ? where(given)
      : treeOf(tree.name, node === undefined ? tree.nodeId : nodeIdOf(node));
  };

  /** A page by `where`'s rule, for a tool that works on pages only, and the take it is of. */
  const pageWhere = Effect.fnUntraced(function* (
    route: string,
    canvas: string | undefined
  ) {
    const at = yield* where({ canvas, route });
    return at.page === null
      ? yield* missing(
          `${route} is a node on the canvas beside the pages, not a page`
        )
      : { page: at.page, takeOf: at.takeOf };
  });

  /** A page by `where`'s rule, for a tool that works on pages only. */
  const pageAt = (route: string, canvas: string | undefined) =>
    Effect.map(pageWhere(route, canvas), ({ page }) => page);

  const documents = <A, E extends { readonly message: string }>(
    f: (service: DocumentService["Service"]) => Effect.Effect<A, E>
  ) => reported(project.use(Effect.flatMap(DocumentService, f)));

  const pagesService = <A, E extends { readonly message: string }>(
    f: (service: PagesService["Service"]) => Effect.Effect<A, E>
  ) => reported(project.use(Effect.flatMap(PagesService, f)));

  return {
    canvasOf,
    documents,
    pageAt,
    pagesOf,
    pagesService,
    pageWhere,
    project,
    treeWhere,
    where,
  };
});
