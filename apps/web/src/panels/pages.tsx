import type { Page } from "@ultrapaint/contracts/pages";
import { routeSegments } from "@ultrapaint/shared/route";
import { cn } from "cn";
import {
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  FilePlus2,
  FileUp,
  House,
  List,
  ListTree,
  Pencil,
  SquareDashed,
  Trash2,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmDialog } from "../components/dialogs.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { importFigma } from "../lib/import-figma.ts";
import { startCommand } from "../lib/start-thread.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";

/** A row's own indent, and where its chevron sits inside it, as in the layers tree. */
const ROW_PAD = 8;
const INDENT = 12;
const CHEVRON_CENTER = 8;

interface RouteNode {
  children: RouteNode[];
  /** The page serving this route, or null for a segment only its children have pages under. */
  page: Page | null;
  route: string;
  segment: string;
}

const emptyNode = (route: string, segment: string): RouteNode => ({
  children: [],
  page: null,
  route,
  segment,
});

/** The routes of a space as a tree, one level per segment, the way the paths nest. */
const routeTree = (pages: readonly Page[]): RouteNode => {
  const root = emptyNode("/", "/");
  for (const page of [...pages].sort((a, b) =>
    a.route.localeCompare(b.route)
  )) {
    let node = root;
    let route = "";
    for (const segment of routeSegments(page.route)) {
      route += `/${segment}`;
      const existing = node.children.find((c) => c.segment === segment);
      if (existing) {
        node = existing;
      } else {
        const child = emptyNode(route, segment);
        node.children.push(child);
        node = child;
      }
    }
    node.page = page;
  }
  return root;
};

const countPages = (node: RouteNode): number =>
  (node.page ? 1 : 0) +
  node.children.reduce((sum, child) => sum + countPages(child), 0);

type View = "grouped" | "flat";

const VIEW_KEY = "ultrapaint:pages-view";

const readView = (): View =>
  localStorage.getItem(VIEW_KEY) === "flat" ? "flat" : "grouped";

/** Every route that has a page, one row each, in route order. */
const flatRows = (pages: readonly Page[]): RouteNode[] =>
  [...pages]
    .sort((a, b) => a.route.localeCompare(b.route))
    .map((page) => ({ ...emptyNode(page.route, page.route), page }));

export const Pages = () => {
  const configured = useProject((s) => s.info.configured);
  const spaces = useProject((s) => s.spaces);
  const pages = useProject((s) => s.pages);
  const space = useEditor((s) => s.space);
  const inSpace = pages.filter((p) => p.space === space);
  const [creating, setCreating] = useState(false);
  const figmaInput = useRef<HTMLInputElement>(null);
  const onFigmaPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const [file] = e.target.files ?? [];
    e.target.value = "";
    if (file) {
      importFigma(file);
    }
  };
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>(readView);
  const activeRoute = useEditor((s) =>
    s.activePage === null
      ? null
      : (pages.find((p) => p.id === s.activePage)?.route ?? null)
  );

  // Arriving on a page opens the groups it sits in; collapsing one afterwards still works.
  const [revealed, setRevealed] = useState<string | null>(null);
  if (activeRoute !== revealed) {
    setRevealed(activeRoute);
    if (activeRoute !== null) {
      const hidden = [...collapsed].filter((route) =>
        activeRoute.startsWith(`${route}/`)
      );
      if (hidden.length > 0) {
        setCollapsed(
          new Set([...collapsed].filter((r) => !hidden.includes(r)))
        );
      }
    }
  }

  const toggleCreating = () => setCreating((c) => !c);
  const openSpace = (id: string) => useEditor.getState().openSpace(id);
  const toggleView = () => {
    const next: View = view === "flat" ? "grouped" : "flat";
    localStorage.setItem(VIEW_KEY, next);
    setView(next);
  };
  const toggle = (route: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(route)) {
        next.delete(route);
      } else {
        next.add(route);
      }
      return next;
    });

  if (!configured) {
    return <PanelEmpty>Configure a repository in settings</PanelEmpty>;
  }

  const tree = routeTree(inSpace);
  // The root row only exists when a page serves `/`; the routes under it sit beside it.
  const rows =
    view === "flat"
      ? flatRows(inSpace)
      : [...(tree.page ? [{ ...tree, children: [] }] : []), ...tree.children];

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        {spaces.length > 1 ? (
          <div className="min-w-0 flex-1">
            <OptionSelect
              className="border-transparent bg-transparent dark:bg-transparent"
              onChange={openSpace}
              options={spaces.map((s) => ({ label: s.name, value: s.id }))}
              size="sm"
              value={space}
            />
          </div>
        ) : (
          <span className="flex-1 truncate text-[11px] text-muted-foreground">
            {spaces[0]?.name ?? "Pages"}
          </span>
        )}
        <IconButton
          onClick={toggleView}
          tooltip={view === "flat" ? "Group by route" : "Show as a flat list"}
        >
          {view === "flat" ? <ListTree /> : <List />}
        </IconButton>
        <IconButton
          onClick={() => figmaInput.current?.click()}
          tooltip="Import a Figma file (.fig): an agent turns its frames into pages"
        >
          <FileUp />
        </IconButton>
        <input
          accept=".fig"
          className="hidden"
          onChange={onFigmaPicked}
          ref={figmaInput}
          type="file"
        />
        <IconButton onClick={toggleCreating} tooltip="New page">
          <FilePlus2 />
        </IconButton>
      </div>
      {creating ? <NewPage onDone={() => setCreating(false)} /> : null}
      {inSpace.length === 0 ? (
        <PanelEmpty>No pages yet. Create one to start.</PanelEmpty>
      ) : (
        <div className="py-1">
          {rows.map((node) => (
            <Row
              collapsed={collapsed}
              depth={0}
              flat={view === "flat"}
              key={node.route}
              node={node}
              onToggle={toggle}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const Row = ({
  node,
  depth,
  collapsed,
  flat = false,
  onToggle,
}: {
  collapsed: Set<string>;
  depth: number;
  /** A row of the flat list: the whole route as its label, no chevron. */
  flat?: boolean;
  node: RouteNode;
  onToggle: (route: string) => void;
}) => {
  const { page } = node;
  // The page serving the router's route, so `/invoices/42` selects `/invoices/:id`.
  const active = useEditor((s) => page !== null && s.activePage === page.id);
  const [renaming, setRenaming] = useState<string | null>(null);
  const open = !collapsed.has(node.route);
  const hasChildren = node.children.length > 0;

  const go = () => {
    if (page) {
      // Already there: stay on the route, and on the parameters it was reached with.
      if (!active) {
        useEditor.getState().navigate(node.route);
      }
    } else {
      onToggle(node.route);
    }
  };
  const chevron = (e: MouseEvent) => {
    e.stopPropagation();
    onToggle(node.route);
  };
  const startRenaming = (e: MouseEvent) => {
    e.stopPropagation();
    setRenaming(node.route);
  };
  const duplicate = (e: MouseEvent) => {
    e.stopPropagation();
    if (page) {
      api().request("pages.duplicate", { id: page.id }).catch(reportError);
    }
  };
  const remove = async (e: MouseEvent) => {
    e.stopPropagation();
    if (!page) {
      return;
    }
    const ok = await confirmDialog({
      confirmLabel: "Delete",
      description: "The page file is removed from the designs directory.",
      destructive: true,
      title: `Delete ${node.route}?`,
    });
    if (ok) {
      api().request("pages.delete", { id: page.id }).catch(reportError);
    }
  };
  const rename = async (to: string) => {
    setRenaming(null);
    if (!page || to === node.route) {
      return;
    }
    try {
      const moved = await api().request("pages.rename", {
        id: page.id,
        route: to,
      });
      useEditor.getState().navigate(moved.route, { push: false });
    } catch (error) {
      reportError(error);
    }
  };

  const Icon = node.route === "/" ? House : SquareDashed;

  return (
    <>
      <div
        className={cn(
          "group flex h-6 items-center gap-1 pr-1 text-[11px]",
          active
            ? "bg-brand/20 text-foreground"
            : "text-muted-foreground hover:bg-muted/50",
          !page && "italic"
        )}
        style={{ paddingLeft: ROW_PAD + depth * INDENT }}
      >
        {!flat && hasChildren ? (
          <button
            aria-label={open ? "Collapse" : "Expand"}
            className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
            onClick={chevron}
            type="button"
          >
            {open ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </button>
        ) : null}
        {flat || hasChildren ? null : (
          <span style={{ width: CHEVRON_CENTER * 2 }} />
        )}
        {renaming === null ? (
          <button
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 truncate text-left"
            onClick={go}
            title={node.route}
            type="button"
          >
            <Icon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {flat || node.route === "/" ? node.route : node.segment}
            </span>
            {page ? null : (
              <span className="shrink-0 text-[10px]">
                {countPages(node)} pages
              </span>
            )}
          </button>
        ) : (
          <RouteInput
            onCancel={() => setRenaming(null)}
            onSubmit={rename}
            value={renaming}
          />
        )}
        {page && renaming === null ? (
          <span className="hidden items-center group-hover:flex">
            <IconButton
              onClick={startRenaming}
              size="icon-xs"
              tooltip="Change route"
            >
              <Pencil className="size-3" />
            </IconButton>
            <IconButton onClick={duplicate} size="icon-xs" tooltip="Duplicate">
              <Copy className="size-3" />
            </IconButton>
            <IconButton
              onClick={(e: MouseEvent) => {
                e.stopPropagation();
                startCommand(`/implement ${node.route}`);
              }}
              size="icon-xs"
              tooltip="Implement in the application with an agent"
            >
              <Code className="size-3" />
            </IconButton>
            <IconButton onClick={remove} size="icon-xs" tooltip="Delete">
              <Trash2 className="size-3" />
            </IconButton>
          </span>
        ) : null}
      </div>
      {open
        ? node.children.map((child) => (
            <Row
              collapsed={collapsed}
              depth={depth + 1}
              key={child.route}
              node={child}
              onToggle={onToggle}
            />
          ))
        : null}
    </>
  );
};

const RouteInput = ({
  value,
  onSubmit,
  onCancel,
}: {
  onCancel: () => void;
  onSubmit: (value: string) => void;
  value: string;
}) => {
  const [draft, setDraft] = useState(value);
  const onChange = (e: ChangeEvent<HTMLInputElement>) =>
    setDraft(e.target.value);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      onCancel();
    }
    if (e.key === "Enter") {
      onSubmit(draft);
    }
  };
  return (
    <Input
      autoFocus
      className="h-5"
      onBlur={onCancel}
      onChange={onChange}
      onKeyDown={onKeyDown}
      value={draft}
    />
  );
};

/** New page: a route to serve and the template to start from. */
const NewPage = ({ onDone }: { onDone: () => void }) => {
  const configured = useProject((s) => s.info.configured);
  const space = useEditor((s) => s.space);
  const route = useEditor((s) => s.route);
  const [value, setValue] = useState(route === "/" ? "/" : `${route}/`);
  const [template, setTemplate] = useState("centered");
  const [templates, setTemplates] = useState<
    readonly { id: string; name: string }[]
  >([]);

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
    try {
      const page = await api().request("pages.create", {
        route: value,
        space: space ?? "",
        template,
      });
      onDone();
      useEditor.getState().navigate(page.route);
    } catch (error) {
      reportError(error);
    }
  };
  const onChange = (e: ChangeEvent<HTMLInputElement>) =>
    setValue(e.target.value);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      create();
    }
  };

  return (
    <div className="flex flex-col gap-1.5 border-b bg-muted/30 p-2">
      <Input
        autoFocus
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Route, e.g. /settings/billing"
        value={value}
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
        <Button onClick={create} size="sm">
          Create
        </Button>
      </div>
    </div>
  );
};
