/**
 * The Library (ADR 0045): the components a design places, the App components then the System
 * components, as a list or as a grid of thumbnails. On a page canvas it is the insert list: a
 * click inserts into the selection, a drag puts one anywhere, on a page or on the canvas, and a
 * ↗ opens the component's board. On a board view it is that view's navigation. The elements
 * (rows, columns, text, images) are the tools' Insert menu's.
 */
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { newInstance } from "@ultrapaint/design-document/factories";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import { ArrowUpRight, LayoutGrid, List, Plus, Search } from "lucide-react";
import type * as React from "react";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { OVERVIEW } from "../boards/library-boards.ts";
import {
  beginDrag,
  cancelDrag,
  LIBRARY_MIME,
  useDrag,
} from "../canvas/drag.ts";
import { drawSpecimen, hashOf } from "../canvas/specimens.ts";
import { promptDialog } from "../components/dialogs.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { NoFolder } from "../components/no-folder.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
import { makeAppOf } from "../lib/menu-actions.ts";
import { insertNode, insertTarget } from "../lib/node-actions.ts";
import { openBoard, useBoard } from "../state/board.ts";
import { useComponents } from "../state/components.ts";
import { api } from "../state/connection.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { frameRefOf, pageOfRef } from "../state/frame-ref.ts";
import { useDesignLook } from "../state/look.ts";
import { reportError, useProject } from "../state/project.ts";
import { ensureEditable } from "../state/setup.ts";

type View = "list" | "grid";
const VIEW_KEY = "ultrapaint:library-view";

const storedView = (): View =>
  localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";

/** Ids are the server's to settle; these only have to be unique within the node. */
const nextId = () => makeIdGenerator();

const instanceOf = (c: ComponentMeta) => newInstance(c, nextId());

/**
 * Everything an entry of the Library does: a click inserts, a drag carries the node, a
 * right-click offers where else it can go.
 */
const entryHandlers = (make: () => DesignNode, name: string) => ({
  draggable: true,
  onClick: () => insertNode(make()),
  onContextMenu: (e: React.MouseEvent) =>
    openMenuAt(e, { kind: "component", make, name }),
  // Dropped somewhere that is not the canvas: nothing lands.
  onDragEnd: () => {
    if (useDrag.getState().dragged?.kind === "new") {
      cancelDrag();
    }
  },
  onDragStart: (e: React.DragEvent) => {
    if (!ensureEditable()) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData(LIBRARY_MIME, JSON.stringify(make()));
    beginDrag({ kind: "new", name }, e.clientX, e.clientY, false);
  },
});

/** Opens a component's board (ADR 0045), from the Library's list or grid; shown on hover. */
const OpenBoard = ({ name }: { name: string }) => (
  <IconButton
    className="invisible text-muted-foreground group-focus-within/item:visible group-hover/item:visible"
    onClick={() => openBoard({ item: name, view: "library" })}
    size="icon-sm"
    tooltip={`Open ${name}'s board`}
  >
    <ArrowUpRight />
  </IconButton>
);

const ListItem = ({ component: c }: { component: ComponentMeta }) => (
  <div className="group/item mx-2 flex h-7 items-center rounded-md pr-0.5 transition-colors hover:bg-accent has-focus-visible:bg-accent">
    <button
      className="flex h-full min-w-0 flex-1 items-center pl-2 text-left font-body font-medium outline-none"
      title={c.description ?? c.name}
      type="button"
      {...entryHandlers(() => instanceOf(c), c.name)}
    >
      <span className="truncate">{c.name}</span>
    </button>
    <OpenBoard name={c.name} />
  </div>
);

/**
 * A component's picture in its tile, never larger than it was drawn: pictures of small nodes are
 * taken at twice their size, so half the picture's own is the component's.
 */
const Thumbnail = ({
  name,
  src,
}: {
  name: string;
  src: string | undefined;
}) => {
  // Its size and whether it loads, read from the picture before it is shown.
  const [read, setRead] = useState<{
    readonly failed: boolean;
    readonly height: number;
    readonly src: string;
    readonly width: number;
  } | null>(null);
  useEffect(() => {
    if (!src) {
      return;
    }
    const image = new Image();
    image.onload = () =>
      setRead({
        failed: false,
        height: image.naturalHeight / 2,
        src,
        width: image.naturalWidth / 2,
      });
    image.onerror = () => setRead({ failed: true, height: 0, src, width: 0 });
    image.src = src;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [src]);
  if (!src || read?.src !== src) {
    return <span className="size-full animate-pulse rounded bg-black/4" />;
  }
  if (read.failed) {
    return <span className="font-body-small text-black/50">{name}</span>;
  }
  return (
    <img
      alt={name}
      className="size-full object-contain"
      draggable={false}
      height={80}
      src={src}
      style={{ maxHeight: read.height, maxWidth: read.width }}
      width={160}
    />
  );
};

const GridItem = ({
  component: c,
  thumbnail,
}: {
  component: ComponentMeta;
  thumbnail: string | undefined;
}) => (
  <div className="group/item flex min-w-0 flex-col gap-0.5 rounded-lg p-1 transition-colors hover:bg-accent has-focus-visible:bg-accent">
    <button
      className="flex h-20 items-center justify-center overflow-hidden rounded-md bg-white p-2 outline-none ring-1 ring-border ring-inset"
      title={c.description ?? c.name}
      type="button"
      {...entryHandlers(() => instanceOf(c), c.name)}
    >
      <Thumbnail name={c.name} src={thumbnail} />
    </button>
    <div className="flex h-6 items-center pl-1">
      <span
        className="min-w-0 flex-1 truncate font-body font-medium"
        title={c.name}
      >
        {c.name}
      </span>
      <OpenBoard name={c.name} />
    </div>
  </div>
);

/**
 * Thumbnails of the components, drawn once per design system and components and kept by the
 * server. Missing ones are drawn one at a time while the grid is open.
 */
const useThumbnails = (
  components: readonly ComponentMeta[],
  active: boolean
) => {
  const designSystem = useDesignSystem((s) => s.designSystem);
  // The project's looks draw them too (ADRs 0028, 0041).
  const { components: files, css } = useDesignLook();
  const key = hashOf(
    `${JSON.stringify(designSystem?.colors ?? [])}:${css}:${JSON.stringify(files)}`
  );
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  // What is drawn follows the names shown, not the identity of the list holding them, and skips
  // what is drawn already, as it stands when the drawing starts.
  const names = components.map((c) => c.name).join("\n");
  const missingOf = useEffectEvent((wanted: readonly string[]) =>
    components.filter((c) => wanted.includes(c.name) && !thumbnails[c.name])
  );
  const draw = useEffectEvent((c: ComponentMeta) =>
    drawSpecimen(instanceOf(c), designSystem)
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    let cancelled = false;
    api()
      .request("thumbnails.get", { key })
      .then((stored) => {
        if (!cancelled) {
          setThumbnails(stored);
          setLoadedKey(key);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key, active]);

  useEffect(() => {
    if (!(active && loadedKey === key)) {
      return;
    }
    let cancelled = false;
    const missing = missingOf(names.split("\n"));
    const run = async () => {
      for (const c of missing) {
        if (cancelled) {
          return;
        }
        // biome-ignore lint/performance/noAwaitInLoops: one frame draws one thumbnail at a time.
        const dataUrl = await draw(c);
        if (cancelled || !dataUrl) {
          continue;
        }
        setThumbnails((t) => ({ ...t, [c.name]: dataUrl }));
        api()
          .request("thumbnails.put", { dataUrl, key, name: c.name })
          .catch(() => undefined);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [active, loadedKey, key, names]);

  return thumbnails;
};

/** The catalogue's components matching a search, in the Library's two sections, each by name. */
const librarySections = (
  components: readonly ComponentMeta[],
  query: string
) => {
  const q = query.trim().toLowerCase();
  const found = components
    .filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
    )
    .toSorted((a, b) => a.name.localeCompare(b.name));
  return [
    {
      items: found.filter((c) => c.importFrom === APP_FROM),
      title: "App components",
    },
    {
      items: found.filter((c) => c.importFrom !== APP_FROM),
      title: "System components",
    },
  ] as const;
};

/**
 * A group's name over its rows, a section's title: above the details of its rows, and with a group
 * after another set three times as far from it as its rows are from each other.
 */
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="flex h-9 items-end px-4 pb-1.5 font-heading-xsmall">
    {children}
  </h3>
);

/** The Library's groups, each after the first set apart by space. */
const SECTION = "[&+&]:pt-6";

/**
 * A new app component, named in a prompt: an empty column placed nowhere (`components.create`),
 * its board opened to build it on.
 */
const newAppComponent = async () => {
  if (!ensureEditable()) {
    return;
  }
  const given = await promptDialog({
    confirmLabel: "Make component",
    description:
      "It starts empty, on a board of its own. Build it there, then place it from Components.",
    placeholder: "Pricing card",
    title: "New app component",
  });
  if (!given?.trim()) {
    return;
  }
  try {
    const made = await api().request("components.create", {
      name: given.trim(),
    });
    await useComponents.getState().load();
    if (made.component) {
      openBoard({ item: made.component.name, view: "library" });
    }
  } catch (error) {
    reportError(error);
  }
};

/** The panel's title, as the rail names it, and New. */
const Title = () => (
  <div className="flex h-11 shrink-0 items-center gap-0.5 pr-2 pl-4">
    <h2 className="flex-1 font-heading-xsmall">Components</h2>
    <IconButton
      className="text-muted-foreground"
      onClick={newAppComponent}
      tooltip="New app component"
    >
      <Plus />
    </IconButton>
  </div>
);

/**
 * The search, and the list or grid choice on the page (the board view's navigation is a list),
 * at the head of the Library.
 */
const SearchBar = ({
  onQuery,
  onView,
  query,
  view,
}: {
  onQuery: (query: string) => void;
  onView?: (view: View) => void;
  query: string;
  view?: View;
}) => (
  <div className="flex shrink-0 items-center gap-1.5 px-2 pb-2">
    <InputGroup>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        aria-label="Search components"
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            onQuery("");
          }
        }}
        placeholder="Search"
        value={query}
      />
    </InputGroup>
    {onView && view ? (
      <div className="w-16 shrink-0">
        <Segmented
          onChange={onView}
          options={[
            {
              label: <List className="size-3.5" />,
              title: "List",
              value: "list",
            },
            {
              label: <LayoutGrid className="size-3.5" />,
              title: "Grid",
              value: "grid",
            },
          ]}
          value={view}
        />
      </div>
    ) : null}
  </div>
);

/** A search that finds nothing: what it looked for, and the way back. */
const NoMatch = ({
  onClear,
  query,
}: {
  onClear: () => void;
  query: string;
}) => (
  <PanelEmpty
    action={
      <Button onClick={onClear} size="sm" variant="secondary">
        Clear search
      </Button>
    }
    icon={<Search />}
    title={`No components match “${query.trim()}”`}
  >
    Search by a component’s name or its category.
  </PanelEmpty>
);

/**
 * No app component yet: one row in the list's shape. With part of a page selected it offers to
 * make one of it; with nothing selected the title's + makes an empty one.
 */
const NoAppComponents = () => {
  const selection = useEditor((s) => s.selection);
  const fromSelection =
    selection !== null && pageOfRef(frameRefOf(selection.frame)) !== null;
  return (
    <div className="mx-2 flex h-7 items-center justify-between gap-2 pl-2">
      <span className="truncate font-body-small text-muted-foreground">
        None yet
      </span>
      {fromSelection ? (
        <Button onClick={() => makeAppOf(selection)} size="sm" variant="ghost">
          Make from selection
        </Button>
      ) : null}
    </div>
  );
};

/** A place of the board view's navigation: lit while it is open, a click opening it. */
const NavRow = ({
  children,
  item,
  lit,
  title,
}: {
  children: React.ReactNode;
  item: string;
  lit: boolean;
  title?: string;
}) => (
  <button
    aria-current={lit ? "page" : undefined}
    className="mx-2 flex h-7 w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 text-left font-body font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
    onClick={() => openBoard({ item, view: "library" })}
    title={title}
    type="button"
  >
    {children}
  </button>
);

/**
 * Components in Design System mode (ADR 0045, 0053): the same list, now the navigation. The
 * Overview, then every component; the one open is lit.
 */
const LibraryNav = ({ open }: { open: string }) => {
  const components = useComponents((s) => s.catalogue);
  const [query, setQuery] = useState("");
  const sections = librarySections(components, query);
  const none = sections.every((s) => s.items.length === 0);
  return (
    <div className="flex h-full flex-col">
      <Title />
      <SearchBar onQuery={setQuery} query={query} />
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {query.trim() ? null : (
          <NavRow item={OVERVIEW} lit={open === OVERVIEW}>
            <LayoutGrid className="size-4 shrink-0" />
            Overview
          </NavRow>
        )}
        {none && query.trim() ? (
          <NoMatch onClear={() => setQuery("")} query={query} />
        ) : null}
        {sections.map((section) =>
          section.items.length === 0 ? null : (
            <section className={SECTION} key={section.title}>
              <SectionTitle>{section.title}</SectionTitle>
              {section.items.map((c) => (
                <NavRow
                  item={c.name}
                  key={c.name}
                  lit={open === c.name}
                  title={c.description ?? c.name}
                >
                  <span className="truncate">{c.name}</span>
                </NavRow>
              ))}
            </section>
          )
        )}
      </div>
    </div>
  );
};

export const Library = () => {
  const configured = useProject((s) => s.info.configured);
  const open = useBoard((s) =>
    s.open?.view === "library" ? s.open.item : null
  );
  if (!configured) {
    return <NoFolder />;
  }
  return open === null ? <InsertList /> : <LibraryNav open={open} />;
};

/**
 * Where a click inserts, at the panel's foot while something is selected: the node or the page
 * picked. With nothing selected it would only name the default, so it is not shown.
 */
const InsertHint = () => {
  // The target is worked out from the selection and the documents.
  const selection = useEditor((s) => s.selection);
  const selectedPage = useEditor((s) => s.selectedPage);
  const activePage = useEditor((s) => s.activePage);
  const canvas = useEditor((s) => s.canvas);
  const docs = useDocuments((s) => s.docs);
  const target = insertTarget({
    activePage,
    canvas,
    docs,
    selectedPage,
    selection,
  });
  if (!(target && (selection || selectedPage))) {
    return null;
  }
  return (
    <p className="shrink-0 truncate border-t px-4 py-2 font-body-small text-muted-foreground">
      Inserts into <span className="text-foreground">{target.name}</span>
    </p>
  );
};

/** The Library on a page canvas: the insert list. */
const InsertList = () => {
  const components = useComponents((s) => s.catalogue);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(storedView);
  const sections = librarySections(components, query);
  const thumbnails = useThumbnails(
    sections.flatMap((s) => s.items),
    view === "grid"
  );
  const searching = query.trim() !== "";
  const none = sections.every((s) => s.items.length === 0);

  const onView = (next: View) => {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  };

  return (
    <div className="flex h-full flex-col">
      <Title />
      <SearchBar onQuery={setQuery} onView={onView} query={query} view={view} />
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {none && searching ? (
          <NoMatch onClear={() => setQuery("")} query={query} />
        ) : null}
        {sections.map((section) => {
          const empty = section.items.length === 0;
          // App components keep their place, empty, until there are some to search.
          if (empty && (searching || section.title !== "App components")) {
            return null;
          }
          return (
            <section className={SECTION} key={section.title}>
              <SectionTitle>{section.title}</SectionTitle>
              {empty ? <NoAppComponents /> : null}
              {view === "list" ? (
                section.items.map((c) => (
                  <ListItem component={c} key={`${c.importFrom}:${c.name}`} />
                ))
              ) : (
                <div className="grid grid-cols-2 gap-1 px-1">
                  {section.items.map((c) => (
                    <GridItem
                      component={c}
                      key={`${c.importFrom}:${c.name}`}
                      thumbnail={thumbnails[c.name]}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <InsertHint />
    </div>
  );
};
