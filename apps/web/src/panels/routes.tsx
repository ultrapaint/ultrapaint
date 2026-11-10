import type { Page } from "@ultrapaint/contracts/pages";
import { basePathOf } from "@ultrapaint/shared/route";
import { FilePlus, Plus, Route } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { CutText } from "../components/cut-text.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { NoFolder } from "../components/no-folder.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { editPageUrl, newRoutedPage } from "../lib/page-actions.ts";
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
 * The canvas's routes, one row each in the order of their URLs, with the page's variants and
 * states under it. A draft, a page without a route, is not in the prototype (ADR 0075).
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
  const entries: Entry[] = pages
    .filter((p) => isBase(p) && p.route !== undefined)
    .map((page) => ({
      page,
      variants: pages
        .filter((p) => !isBase(p) && basePathOf(p.path) === page.path)
        .sort((a, b) => rank(a) - rank(b)),
    }));
  return entries.sort((a, b) =>
    (a.page.route ?? "").localeCompare(b.page.route ?? "")
  );
};

/** Gives the canvas a route: a new page that serves one, or one of its drafts given one. */
const NewRoute = ({ drafts }: { drafts: readonly Page[] }) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <IconButton
          className="text-muted-foreground"
          size="icon-sm"
          tooltip="New route"
          variant="ghost"
        />
      }
    >
      <Plus />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-60">
      <DropdownMenuGroup>
        <DropdownMenuItem onClick={() => newRoutedPage()}>
          <FilePlus />
          New page with a route…
        </DropdownMenuItem>
      </DropdownMenuGroup>
      {drafts.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Give a draft a route</DropdownMenuLabel>
            {drafts.map((draft) => (
              <DropdownMenuItem
                key={draft.id}
                onClick={() => editPageUrl(draft)}
              >
                <span className="min-w-0 flex-1 truncate">{draft.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </>
      ) : null}
    </DropdownMenuContent>
  </DropdownMenu>
);

/**
 * The routes of the open canvas, which are what the prototype shows (ADR 0075): each with the
 * page that serves it. The prototype is for clicking through: a row opens its route, and the +
 * gives the canvas another.
 */
export const Routes = () => {
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
  const drafts = inCanvas
    .filter((p) => isBase(p) && p.route === undefined)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 pr-2 pl-4">
        <h2 className="flex-1 truncate font-heading-xsmall">Routes</h2>
        <NewRoute drafts={drafts} />
      </div>
      {entries.length === 0 ? (
        <PanelEmpty icon={<Route />} title="No routes yet">
          The prototype clicks through the pages that serve a route. Give one a
          route with +, or from its name on the canvas.
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
        type="button"
      >
        {/* The route first, the page that serves it after. */}
        <CutText
          className="min-w-0 shrink-0 truncate font-code"
          tip={`${page.route}${page.route === home ? " (home)" : ""} · ${page.file}`}
        >
          {page.route}
        </CutText>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {page.name}
        </span>
        <StatusDot target={page.id} />
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
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={statusLabel(item)}
            className={cn("size-1.5 shrink-0 rounded-full", color)}
            role="img"
          />
        }
      />
      <TooltipContent>{statusLabel(item)}</TooltipContent>
    </Tooltip>
  );
};

/**
 * A page drawn again for a variant, opening which puts the prototype in that variant; or the
 * page in a state (ADR 0030), which a link opens.
 */
const VariantRow = ({ page }: { page: Page }) => {
  const active = useEditor((s) => s.activePage === page.id);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-current={active ? "page" : undefined}
            className={rowClass(active)}
            onClick={() => openPage(page)}
            style={{ paddingLeft: 24 }}
            type="button"
          />
        }
      >
        {/* Under its page, named by what it is: a variant, or a state of the page. */}
        <span className="min-w-0 flex-1 truncate">
          {page.variant ?? page.state}
        </span>
        <StatusDot target={page.id} />
        <span className="shrink-0 font-body-small text-muted-foreground">
          {page.state === undefined ? "Variant" : "State"}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {page.state === undefined
          ? `${page.name} in the ${page.variant} variant`
          : `${page.name} when it is ${page.state}`}
      </TooltipContent>
    </Tooltip>
  );
};
