/**
 * What an agent is asked to do in the benchmark, and how a run is judged done.
 *
 * screen out of the design's components — written the way someone would type them, with
 * screen out of the repository's own components — written the way someone would type them, with
 * no hints about where things live. What the agent has to find out for itself is the point: that
 * is what a briefing, or an MCP, would save it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export interface TaskContext {
  /** Absolute path of the designs directory the run works in. */
  readonly designs: string;
  readonly repo: string;
}

export interface BenchTask {
  /** What the work has to end up being. A reason when it is not. */
  readonly check: (ctx: TaskContext) => string | null;
  /** Files the run starts from, relative to the designs directory. */
  readonly given?: Readonly<Record<string, string>>;
  readonly id: string;
  readonly prompt: string;
}

const FORM_COMPONENT_RE = /Input|Field|Label/;
const BUTTON_RE = /Button/;

interface Node {
  readonly children?: readonly Node[];
  readonly component?: string;
  readonly link?: string;
  readonly role?: string;
  readonly type?: string;
}

const read = (ctx: TaskContext, rel: string) => {
  try {
    return readFileSync(path.join(ctx.designs, rel), "utf8");
  } catch (error) {
    // A file the agent did not write is a check that fails; anything else is the bench's.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

/**
 * The page that serves a URL in the designs directory's own canvas: the one `canvas.json` routes
 * there, or, before it names any, the one whose path the URL is.
 */
const pageServing = (ctx: TaskContext, url: string): Node | null => {
  const layout = read(ctx, "canvas.json");
  const routes = layout
    ? ((JSON.parse(layout) as { routes?: Record<string, string> }).routes ??
      null)
    : null;
  const file =
    (routes
      ? Object.entries(routes).find(([, route]) => route === url)?.[0]
      : undefined) ??
    (routes ? undefined : `${url === "/" ? "index" : url.slice(1)}.page.json`);
  const text = file ? read(ctx, file) : null;
  return text ? (JSON.parse(text) as { root: Node }).root : null;
};

/** The file of the page that serves /pricing, when one does. */
const pricingFile = (ctx: TaskContext) => {
  const layout = read(ctx, "canvas.json");
  const routes = layout
    ? (JSON.parse(layout) as { routes?: Record<string, string> }).routes
    : undefined;
  return routes
    ? Object.entries(routes).find(([, route]) => route === "/pricing")?.[0]
    : undefined;
};

const nodesOf = (root: Node): Node[] => [
  root,
  ...(root.children ?? []).flatMap(nodesOf),
];

const HOME_PAGE = `${JSON.stringify(
  {
    root: {
      children: [
        {
          id: "t_title",
          level: 1,
          role: "heading",
          text: "Acme",
          type: "text",
        },
        {
          id: "t_sub",
          role: "paragraph",
          text: "Everything in one place.",
          type: "text",
        },
      ],
      gap: 8,
      id: "root",
      padding: 32,
      type: "page",
    },
    version: 1,
  },
  null,
  2
)}\n`;

export const tasks: readonly BenchTask[] = [
  {
    check: (ctx) => {
      const page = pageServing(ctx, "/pricing");
      if (!page) {
        return "no page serves /pricing";
      }
      return nodesOf(page).some((n) => n.role === "heading")
        ? null
        : "the pricing page has no heading";
    },
    id: "new-page",
    prompt:
      "Add a pricing page to the design, at the route /pricing. Give it a heading and three plan cards.",
  },
  {
    check: (ctx) => {
      const page = pageServing(ctx, "/");
      if (!page) {
        return "the home page is gone";
      }
      return nodesOf(page).some(
        (n) => n.type === "instance" && BUTTON_RE.test(n.component ?? "")
      )
        ? null
        : "the page does not use the Button component";
    },
    given: { "index.page.json": HOME_PAGE },
    id: "use-component",
    prompt:
      "On the home page, add a call-to-action button under the paragraph that says 'Get started'. Use the repository's own button component, not a plain <button>.",
  },
  {
    check: (ctx) => {
      const page = pageServing(ctx, "/settings/billing");
      if (!page) {
        return "no page serves /settings/billing";
      }
      return nodesOf(page).some(
        (n) =>
          n.type === "instance" && FORM_COMPONENT_RE.test(n.component ?? "")
      )
        ? null
        : "the form does not use the repository's form components";
    },
    id: "form-from-catalogue",
    prompt:
      "Create a billing settings page at /settings/billing with a form: a card name field, a card number field, and a save button. Build it from the components the repository already has.",
  },
  {
    check: (ctx) => {
      const page = pageServing(ctx, "/");
      if (!page) {
        return "the home page is gone";
      }
      // A link names the URL, or the page file that serves it (ADR 0021).
      const target = pricingFile(ctx);
      return nodesOf(page).some(
        (n) => n.link === "/pricing" || (!!target && n.link === target)
      )
        ? null
        : "no node links to /pricing";
    },
    given: { "index.page.json": HOME_PAGE },
    id: "router-link",
    prompt:
      "On the home page, add a link under the heading that goes to the /pricing page, so that clicking it in the prototype navigates there.",
  },
];
