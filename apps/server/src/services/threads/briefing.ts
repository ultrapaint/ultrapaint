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
import type { PageList } from "@ultrapaint/contracts/pages";
import { Context, Effect, Layer } from "effect";
import { ProjectManager } from "../../project.ts";
import { CatalogueService } from "../catalogue.ts";
import { PagesService } from "../pages.ts";
import { RepoPaths } from "../repo-paths.ts";

/** Enough of the palette to choose from; the agent reads the rest when it needs to. */
const COMPONENT_LIMIT = 60;

const componentLine = (component: ComponentMeta) => {
  const variants = Object.entries(component.variants)
    .map(([name, members]) => `${name}: ${members.join("|")}`)
    .join(", ");
  return `- ${component.name} (${component.importFrom})${variants ? ` — ${variants}` : ""}`;
};

const routesOf = (pages: PageList) =>
  pages.pages.length === 0
    ? "There are no pages yet."
    : pages.pages.map((page) => `- ${page.route} → ${page.file}`).join("\n");

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

        return `<ultrapaint>
You are working in ultrapaint, a design tool whose canvas renders this repository's real React
pages. The user sees the pages you edit, live, as you edit them.

Designs live in ${settings.designsDir}. A page is a .tsx file there and its path is its route:
index.tsx is /, settings/billing.tsx is /settings/billing, invoices/[id].tsx is /invoices/:id.
A page is a default-exported React component and takes no props.

Pages navigate through ./_router.tsx, written next to them: import { Link, useNavigate,
useParams, useRoute } from "./_router.tsx" (from a subdirectory, "../_router.tsx"). Use it
instead of an <a href> so the prototype navigates inside the canvas. Do not edit _router.tsx.

Pages import what ${settings.resolveFrom ?? "the designs directory"} can import, and nothing is
installed for them. Styling follows this repository's own conventions — read a neighbouring page
or component rather than inventing one.

Routes that exist now:
${routesOf(pages)}

${
  components.length > 0
    ? `Components you can use${more > 0 ? ` (${more} more in ${settings.libraryDirs.join(", ")})` : ""}:
${components.map(componentLine).join("\n")}`
    : `Components live in ${settings.libraryDirs.join(", ") || "this repository"}.`
}

Work only inside ${paths.root}. Edits land on the canvas as you save them, so make them one at a
time rather than rewriting a page wholesale.
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
