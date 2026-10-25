import type { Page } from "@ultrapaint/contracts/pages";
import { slugOf } from "@ultrapaint/shared/path";
import { basePathOf } from "@ultrapaint/shared/route";
import { cn } from "cn";
import {
  Code,
  Copy,
  File,
  FilePlus2,
  House,
  Link2,
  Split,
  SquareDashed,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { SetupEmpty } from "../components/setup-dialog.tsx";
import {
  createPage,
  DEFAULT_TEMPLATE,
  deletePage,
  duplicatePage,
  implementPage,
  NO_URL_HINT,
  renamePageTo,
  setPageUrl,
} from "../lib/page-actions.ts";
import { api } from "../state/connection.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { useEditor } from "../state/editor.ts";
import { statusLabel, useImplementation } from "../state/implementation.ts";
import { usePagePicks } from "../state/page-picks.ts";
import { useProject } from "../state/project.ts";
import { InlineInput } from "./canvases.tsx";

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
 * warning when it has none, since nothing in the click-through leads to it then.
 */
export const Pages = () => {
  const configured = useProject((s) => s.info.configured);
  const pages = useProject((s) => s.pages);
  const canvases = useProject((s) => s.canvases);
  const canvas = useEditor((s) => s.canvas);
  const info = canvases.find((c) => c.id === canvas);
  const [creating, setCreating] = useState(false);

  if (!configured) {
    return <SetupEmpty />;
  }

  const inCanvas = pages.filter((p) => p.canvas === canvas);
  const entries = entriesOf(inCanvas, info?.variants ?? [], info?.states ?? []);
  const unreachable = entries.filter((e) => e.page.route === undefined).length;

  return (
    <div className="flex flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 pr-1.5 pl-3">
        <span className="flex-1 truncate font-heading-xsmall">Pages</span>
        {unreachable > 0 ? (
          <span
            className="flex items-center gap-1 font-body text-warning"
            title={`${unreachable} ${unreachable === 1 ? "page has" : "pages have"} no URL: the prototype cannot reach ${unreachable === 1 ? "it" : "them"}`}
          >
            <TriangleAlert className="size-3" />
            {unreachable} without URL
          </span>
        ) : null}
        <IconButton onClick={() => setCreating((c) => !c)} tooltip="New page">
          <FilePlus2 />
        </IconButton>
      </div>
      {creating ? <NewPage onDone={() => setCreating(false)} /> : null}
      {entries.length === 0 ? (
        <PanelEmpty>No pages yet. Create one to start.</PanelEmpty>
      ) : (
        <div className="py-1">
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

/** A page's row: the one the prototype is on, one picked with others, or neither. */
const rowClass = (active: boolean, picked: boolean) =>
  cn(
    "group flex h-7 items-center gap-1.5 pr-1 font-body",
    active && "bg-brand/20 text-foreground",
    !active && picked && "bg-muted text-foreground",
    !(active || picked) && "text-muted-foreground hover:bg-muted/50"
  );

/**
 * A page opened from the list, or picked with ⌘ or Shift for a menu that acts on several; the
 * prototype then stays where it is. Opening a variant's page puts it in its variant.
 */
const openPage = (page: Page, e: MouseEvent) => {
  const picks = usePagePicks.getState();
  if (e.metaKey || e.ctrlKey || e.shiftKey) {
    picks.toggle(page.id);
    return;
  }
  picks.clear();
  useEditor.getState().openPage(page.id);
};

const stop = (f: () => unknown) => (e: MouseEvent) => {
  e.stopPropagation();
  f();
};

/** Where the page is served, or the warning that it is not; a click edits it in place. */
const UrlLabel = ({
  onEdit,
  route,
}: {
  onEdit: () => void;
  route: string | undefined;
}) =>
  route === undefined ? (
    <button
      className="flex shrink-0 items-center gap-1 rounded px-1 font-body text-warning hover:bg-warning/10"
      onClick={stop(onEdit)}
      title={NO_URL_HINT}
      type="button"
    >
      <TriangleAlert className="size-3" />
      No URL
    </button>
  ) : (
    <button
      className="min-w-0 truncate rounded px-1 font-code text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={stop(onEdit)}
      title={`Served at ${route}. Click to change the URL`}
      type="button"
    >
      {route}
    </button>
  );

const PageRow = ({ entry, home }: { entry: Entry; home: string }) => {
  const { page } = entry;
  const active = useEditor((s) => s.activePage === page.id);
  const picked = usePagePicks((s) => s.ids.includes(page.id));
  const [editing, setEditing] = useState<"name" | "url" | null>(null);
  const onContextMenu = (e: MouseEvent) =>
    openMenuAt(e, { kind: "page", pageId: page.id });
  const Icon = page.route === home ? House : File;
  const done = () => setEditing(null);

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the row's buttons raise the menu from the keyboard, and it bubbles here. */}
      <div
        className={rowClass(active, picked)}
        onContextMenu={onContextMenu}
        style={{ paddingLeft: 10 }}
      >
        <Icon
          className={cn(
            "size-3 shrink-0",
            page.route === undefined ? "text-warning" : "text-muted-foreground"
          )}
        />
        {editing === "name" ? (
          <InlineInput
            onCancel={done}
            onSubmit={(name) => {
              done();
              renamePageTo(page, name);
            }}
            value={page.name}
          />
        ) : (
          <button
            className="flex h-full min-w-0 flex-1 items-center truncate text-left"
            onClick={(e) => openPage(page, e)}
            onDoubleClick={() => isBase(page) && setEditing("name")}
            title={`${page.name} · ${page.file}`}
            type="button"
          >
            <span className="truncate">
              {page.name}
              {page.variant === undefined ? "" : ` · ${page.variant}`}
              {page.state === undefined ? "" : ` · ${page.state}`}
            </span>
          </button>
        )}
        <StatusDot target={page.id} />
        {editing === "url" ? (
          <InlineInput
            className="max-w-[55%]"
            mono
            onCancel={done}
            onSubmit={(url) => {
              done();
              setPageUrl(page, url);
            }}
            placeholder="/settings/billing"
            value={page.route ?? `/${slugOf(page.name)}`}
          />
        ) : null}
        {editing === null ? (
          <>
            <span className="hidden items-center group-hover:flex">
              <IconButton
                onClick={stop(() => setEditing("url"))}
                size="icon-xs"
                tooltip={page.route === undefined ? "Set URL" : "Change URL"}
              >
                <Link2 className="size-3" />
              </IconButton>
              <IconButton
                onClick={stop(() => duplicatePage(page))}
                size="icon-xs"
                tooltip="Duplicate"
              >
                <Copy className="size-3" />
              </IconButton>
              <IconButton
                onClick={stop(() => implementPage(page))}
                size="icon-xs"
                tooltip="Implement in the application with an agent"
              >
                <Code className="size-3" />
              </IconButton>
              <IconButton
                onClick={stop(() => deletePage(page))}
                size="icon-xs"
                tooltip="Delete"
              >
                <Trash2 className="size-3" />
              </IconButton>
            </span>
            <span className="flex min-w-0 max-w-[55%] shrink-0 group-hover:hidden">
              <UrlLabel onEdit={() => setEditing("url")} route={page.route} />
            </span>
          </>
        ) : null}
      </div>
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
  const color = {
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
  const picked = usePagePicks((s) => s.ids.includes(page.id));
  const onContextMenu = (e: MouseEvent) =>
    openMenuAt(e, { kind: "page", pageId: page.id });
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the row's buttons raise the menu from the keyboard, and it bubbles here.
    <div
      className={rowClass(active, picked)}
      onContextMenu={onContextMenu}
      style={{ paddingLeft: 26 }}
    >
      <button
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 truncate text-left"
        onClick={(e) => openPage(page, e)}
        title={
          page.state === undefined
            ? `${page.name} in the ${page.variant} variant`
            : `${page.name} when it is ${page.state}`
        }
        type="button"
      >
        {page.state === undefined ? (
          <Split className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <SquareDashed className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{page.variant ?? page.state}</span>
      </button>
      <StatusDot target={page.id} />
      <span className="hidden items-center group-hover:flex">
        <IconButton
          onClick={stop(() => duplicatePage(page))}
          size="icon-xs"
          tooltip="Duplicate"
        >
          <Copy className="size-3" />
        </IconButton>
        <IconButton
          onClick={stop(() => deletePage(page))}
          size="icon-xs"
          tooltip="Delete"
        >
          <Trash2 className="size-3" />
        </IconButton>
      </span>
    </div>
  );
};

/**
 * New page: what it is called, the URL it serves (made from the name until it is typed, and
 * optional), and the template it starts from.
 */
const NewPage = ({ onDone }: { onDone: () => void }) => {
  const configured = useProject((s) => s.info.configured);
  const [name, setName] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [templates, setTemplates] = useState<
    readonly { id: string; name: string }[]
  >([]);
  const shownUrl = url ?? (name.trim() === "" ? "" : `/${slugOf(name)}`);

  useEffect(() => {
    if (!configured) {
      return;
    }
    api()
      .request("pages.templates", undefined)
      .then(setTemplates)
      .catch(() => undefined);
  }, [configured]);

  const create = async () => {
    if (name.trim() === "") {
      return;
    }
    const page = await createPage({ name, route: shownUrl, template });
    if (page) {
      onDone();
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      create();
    }
    if (e.key === "Escape") {
      onDone();
    }
  };

  return (
    <div className="flex flex-col gap-1.5 border-y bg-muted/30 p-2">
      <Input
        autoFocus
        onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Name, e.g. Billing settings"
        value={name}
      />
      <Input
        className="font-mono"
        onChange={(e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="URL (optional), e.g. /settings/billing"
        value={shownUrl}
      />
      <OptionSelect
        onChange={setTemplate}
        options={templates.map((t) => ({ label: t.name, value: t.id }))}
        value={template}
      />
      <div className="flex justify-end gap-1">
        <Button onClick={onDone} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button disabled={name.trim() === ""} onClick={create} size="sm">
          Create
        </Button>
      </div>
    </div>
  );
};
