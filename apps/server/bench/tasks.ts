/**
 * What an agent is asked to do in the benchmark, and how a run is judged done.
 *
 * The tasks are the work the tool exists for — make a page, change one on the canvas, build a
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

const DEFAULT_EXPORT_RE = /export default/;
const FORM_COMPONENT_RE = /Input|Field|Label/;

const read = (ctx: TaskContext, rel: string) => {
  try {
    return readFileSync(path.join(ctx.designs, rel), "utf8");
  } catch {
    return null;
  }
};

const HOME_PAGE = `export default function Home() {
  return (
    <main className="p-8">
      <h1 className="font-semibold text-2xl">Acme</h1>
      <p className="text-muted-foreground">Everything in one place.</p>
    </main>
  );
}
`;

export const tasks: readonly BenchTask[] = [
  {
    check: (ctx) => {
      const page = read(ctx, "pricing.tsx");
      if (!page) {
        return "docs/bench-designs/pricing.tsx was not created";
      }
      return DEFAULT_EXPORT_RE.test(page) ? null : "no default export";
    },
    id: "new-page",
    prompt:
      "Add a pricing page to the design, at the route /pricing. Give it a heading and three plan cards.",
  },
  {
    check: (ctx) => {
      const page = read(ctx, "index.tsx");
      if (!page) {
        return "index.tsx is gone";
      }
      return page.includes("Button")
        ? null
        : "the page does not use the Button component";
    },
    given: { "index.tsx": HOME_PAGE },
    id: "use-component",
    prompt:
      "On the home page, add a call-to-action button under the paragraph that says 'Get started'. Use the repository's own button component, not a plain <button>.",
  },
  {
    check: (ctx) => {
      const page = read(ctx, "settings/billing.tsx");
      if (!page) {
        return "docs/bench-designs/settings/billing.tsx was not created";
      }
      return FORM_COMPONENT_RE.test(page)
        ? null
        : "the form does not use the repository's form components";
    },
    id: "form-from-catalogue",
    prompt:
      "Create a billing settings page at /settings/billing with a form: a card name field, a card number field, and a save button. Build it from the components the repository already has.",
  },
  {
    check: (ctx) => {
      const page = read(ctx, "index.tsx");
      if (!page) {
        return "index.tsx is gone";
      }
      return page.includes("_router")
        ? null
        : "the link does not go through the canvas's router";
    },
    given: { "index.tsx": HOME_PAGE },
    id: "router-link",
    prompt:
      "On the home page, add a link under the heading that goes to the /pricing page, so that clicking it in the prototype navigates there.",
  },
];
