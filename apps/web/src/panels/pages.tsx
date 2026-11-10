import type { Page } from "@ultrapaint/contracts/pages";
import { basePathOf } from "@ultrapaint/shared/route";
import { Files, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { NoFolder } from "../components/no-folder.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { NO_URL_HINT } from "../lib/page-actions.ts";
import { useEditor } from "../state/editor.ts";
import {
  statusLabel,
  tokensWaiting,
  useImplementation,
} from "../state/implementation.ts";
import { goTo } from "../state/location.ts";
import { useProject } from "../state/project.ts";

interface Entry {
  page: Page;
  /**
   * The route's pages drawn for a variant, in the canvas's order of variants, then the page in
   * its states (ADR 0030), in the canvas's order of states.
   */
  variants: Page[];
}

const isBase = (p: Page) => p.variant === undefined && p.state === undefined;

/**
 * The canvas's pages, one row each, with their variants and states under them: the ones in the
 * prototype first, in the order of their URLs, then the ones it cannot reach, by name.
 */
const entriesOf = (
  pages: readonly Page[],
  order: readonly string[],
  states: readonly string[]
) => {
  const rank = (p: Page) =>
    p.variant === undefined
      ? order.length + states.indexOf(p.state ?? "")
      : order.indexOf(p.variant);
  const entries: Entry[] = pages.filter(isBase).map((page) => ({
    page,
    variants: pages
      .filter((p) => !isBase(p) && basePathOf(p.path) === page.path)
      .sort((a, b) => rank(a) - rank(b)),
  }));
  // A variant or a state whose base page is gone is still a page of the canvas.
  for (const orphan of pages.filter(
    (p) =>
      !(
        isBase(p) ||
        pages.some((b) => isBase(b) && b.path === basePathOf(p.path))
      )
  )) {
    entries.push({ page: orphan, variants: [] });
  }
  return entries.sort((a, b) => {
    const left = a.page.route;
    const right = b.page.route;
    if (left !== undefined && right !== undefined) {
      return left.localeCompare(right);
    }
    if (left !== undefined || right !== undefined) {
      return left === undefined ? 1 : -1;
    }
    return a.page.name.localeCompare(b.page.name);
  });
};

/**
 * The pages of the open canvas as the prototype sees them: each with the URL it serves, or a
 * warning when it has none, since nothing in the click-through leads to it then. The prototype
 * is for clicking through: the list opens pages and changes none.
 */
export const Pages = () => {
  const configured = useProject((s) => s.info.configured);
  const pages = useProject((s) => s.pages);
  const canvases = useProject((s) => s.canvases);
  const canvas = useEditor((s) => s.canvas);
  const info = canvases.find((c) => c.id === canvas);

  if (!configured) {
    return <NoFolder />;
  }

  const inCanvas = pages.filter((p) => p.canvas === canvas);
  const entries = entriesOf(inCanvas, info?.variants ?? [], info?.states ?? []);
  const unreachable = entries.filter((e) => e.page.route === undefined).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 pr-3 pl-4">
        <h2 className="flex-1 truncate font-heading-xsmall">Pages</h2>
        {unreachable > 0 ? (
          <span
            className="flex shrink-0 items-center gap-1.5 font-body-small text-muted-foreground"
            title={`${unreachable === 1 ? "A page has" : `${unreachable} pages have`} no URL: no link of the prototype leads to ${unreachable === 1 ? "it" : "them"}`}
          >
            <TriangleAlert className="size-3.5 text-warning" />
            {unreachable} without a URL
          </span>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <PanelEmpty icon={<Files />} title="No pages yet">
          The pages drawn on this canvas are listed here, to click through.
        </PanelEmpty>
      ) : (
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {entries.map((entry) => (
            <PageRow
              entry={entry}
              home={info?.home ?? "/"}
              key={entry.page.id}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/** A row, filled while the prototype is on its page. */
const rowClass = (active: boolean) =>
  cn(
    "flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left font-body outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring",
    active ? "bg-accent text-foreground" : "text-foreground hover:bg-accent/50"
  );

const openPage = (page: Page) => goTo({ page: page.id });

const PageRow = ({ entry, home }: { entry: Entry; home: string }) => {
  const { page } = entry;
  const active = useEditor((s) => s.activePage === page.id);
  return (
    <>
      <button
        aria-current={active ? "page" : undefined}
        className={rowClass(active)}
        onClick={() => openPage(page)}
        style={{ paddingLeft: 8 }}
        title={`${page.name}${page.route === home ? " (home)" : ""} · ${page.file}`}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate font-body-medium">
          {page.name}
        </span>
        <StatusDot target={page.id} />
        {page.route === undefined ? (
          <span
            className="flex shrink-0 items-center gap-1.5 font-body-small text-muted-foreground"
            title={NO_URL_HINT}
          >
            <TriangleAlert className="size-3.5 text-warning" />
            No URL
          </span>
        ) : (
          <span className="min-w-0 max-w-[55%] shrink-0 truncate font-code text-muted-foreground">
            {page.route}
          </span>
        )}
      </button>
      {entry.variants.map((variant) => (
        <VariantRow key={variant.id} page={variant} />
      ))}
    </>
  );
};

/**
 * Where a page stands with its code (ADR 0030): nothing while it is a draft, a dot otherwise —
 * ready, implemented, or changed since on one side or both.
 */
const StatusDot = ({ target }: { target: string }) => {
  const item = useImplementation((s) => s.byTarget[target]);
  if (!item || item.status === "draft") {
    return null;
  }
  const color = tokensWaiting(item)
    ? "bg-warning"
    : {
        changed: "bg-warning",
        implemented: "bg-success",
        ready: "bg-primary",
      }[item.status];
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", color)}
      title={statusLabel(item)}
    />
  );
};

/**
 * A page drawn again for a variant, opening which puts the prototype in that variant; or the
 * page in a state (ADR 0030), which a link opens.
 */
const VariantRow = ({ page }: { page: Page }) => {
  const active = useEditor((s) => s.activePage === page.id);
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={rowClass(active)}
      onClick={() => openPage(page)}
      style={{ paddingLeft: 24 }}
      title={
        page.state === undefined
          ? `${page.name} in the ${page.variant} variant`
          : `${page.name} when it is ${page.state}`
      }
      type="button"
    >
      {/* Under its page, named by what it is: a variant, or a state of the page. */}
      <span className="min-w-0 flex-1 truncate">
        {page.variant ?? page.state}
      </span>
      <StatusDot target={page.id} />
      <span className="shrink-0 font-body-small text-muted-foreground">
        {page.state === undefined ? "Variant" : "State"}
      </span>
    </button>
  );
};
