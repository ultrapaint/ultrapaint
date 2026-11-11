/**
 * The Library (ADR 0045): the components a design places, the App components then the System
 * components, as a list or as a grid of thumbnails. On a page canvas it is the insert list: a
 * click inserts into the selection, a drag puts one anywhere, on a page or on the canvas, and a
 * chevron, or Open board in its menu, opens the component's board; the components placed last lead
 * it, as Recent. On a board view it is that view's navigation. Each group is one Tab stop, the
 * arrow keys moving among its rows. The elements (rows, columns, text, images) are the tools'
 * Insert menu's.
 */
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { newInstance } from "@ultrapaint/design-document/factories";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import {
  ChevronRight,
  ImageOff,
  LayoutGrid,
  List,
  Plus,
  Search,
} from "lucide-react";
import type * as React from "react";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { OVERVIEW } from "../boards/library-boards.ts";
import {
  beginDrag,
  cancelDrag,
  LIBRARY_MIME,
  useDrag,
} from "../canvas/drag.ts";
import { drawSpecimen, hashOf } from "../canvas/specimens.ts";
import { CutText } from "../components/cut-text.tsx";
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
import {
  type MenuTarget,
  openMenuAt,
  showMenu,
} from "../state/context-menu.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { frameRefOf, pageOfRef } from "../state/frame-ref.ts";
import { useDesignLook } from "../state/look.ts";
import { reportError, useProject } from "../state/project.ts";
import { noteLanded, useRecentComponents } from "../state/recent-components.ts";
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
 * right-click, or the menu key on the row, offers where else it can go and its board.
 */
const entryHandlers = (make: () => DesignNode, name: string) => ({
  draggable: true,
  onClick: () => {
    const node = make();
    Promise.resolve(insertNode(node)).then(noteLanded(node));
  },
  onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
    const target: MenuTarget = { kind: "component", make, name };
    // From the keyboard there is no pointer: the menu opens against the row.
    if (e.clientX === 0 && e.clientY === 0) {
      e.preventDefault();
      showMenu(target, e.currentTarget);
      return;
    }
    openMenuAt(e, target);
  },
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

/**
 * Opens a component's board (ADR 0045), from the Library's list or grid; shown on hover. No Tab
 * stop of its own: from the keyboard, the row's menu has Open board.
 */
const OpenBoard = ({ name }: { name: string }) => (
  <IconButton
    className="invisible text-muted-foreground group-focus-within/item:visible group-hover/item:visible"
    onClick={() => openBoard({ item: name, view: "library" })}
    size="icon-sm"
    tabIndex={-1}
    tooltip={`Open ${name}'s board`}
  >
    <ChevronRight />
  </IconButton>
);

/** Whether a one-line name is cut short by its `truncate`. */
const isCut = (el: HTMLElement) => el.scrollWidth > el.clientWidth;

/**
 * A component's name in the Library: its whole name in the tooltip when it is cut short, then its
 * description when it has one; the description alone when the name fits.
 */
const ComponentName = ({
  className,
  component: c,
}: {
  className: string;
  component: ComponentMeta;
}) => {
  const [cut, setCut] = useState(false);
  if (!c.description) {
    return <CutText className={className}>{c.name}</CutText>;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={className}
            onPointerEnter={(e) => setCut(isCut(e.currentTarget))}
          />
        }
      >
        {c.name}
      </TooltipTrigger>
      <TooltipContent>
        {cut ? <span className="block">{c.name}</span> : null}
        {c.description}
      </TooltipContent>
    </Tooltip>
  );
};

/**
 * A Library entry's keyboard focus: the ring around the whole item when its row button has it,
 * so the accent fill means hover alone (DESIGN.md, Components).
 */
const ITEM_FOCUS =
  "has-[[data-row]:focus-visible]:ring-2 has-[[data-row]:focus-visible]:ring-ring";

/**
 * A group's rows as one Tab stop (a roving tabindex): the row focused last, else the first, and
 * the arrow keys move among them, by `columns` up and down in a grid. Its rows are what is marked
 * `data-row`.
 */
const useRovingRows = (count: number, columns = 1) => {
  const [stop, setStop] = useState(0);
  const at = Math.min(stop, count - 1);
  const rowsOf = (list: HTMLElement) => [
    ...list.querySelectorAll<HTMLElement>("[data-row]"),
  ];
  const onFocus = (e: React.FocusEvent<HTMLElement>) => {
    const index = rowsOf(e.currentTarget).indexOf(e.target);
    if (index >= 0) {
      setStop(index);
    }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const rows = rowsOf(e.currentTarget);
    const from = rows.indexOf(e.target as HTMLElement);
    const steps: Record<string, number> = {
      ArrowDown: columns,
      ArrowUp: -columns,
      ...(columns > 1 && { ArrowLeft: -1, ArrowRight: 1 }),
    };
    const step = steps[e.key];
    let to: number | undefined;
    if (e.key === "Home") {
      to = 0;
    } else if (e.key === "End") {
      to = rows.length - 1;
    } else if (step !== undefined) {
      to = from + step;
    }
    if (from < 0 || to === undefined) {
      return;
    }
    e.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, to))]?.focus();
  };
  return {
    list: { onFocus, onKeyDown },
    tabIndexOf: (index: number) => (index === at ? 0 : -1),
  };
};

const ListItem = ({
  component: c,
  tabIndex,
}: {
  component: ComponentMeta;
  tabIndex: number;
}) => (
  <li
    className={`group/item mx-2 flex h-7 items-center rounded-md pr-1 transition-colors hover:bg-accent ${ITEM_FOCUS}`}
  >
    <button
      className="flex h-full min-w-0 flex-1 items-center pl-2 text-left font-body-medium outline-none"
      data-row
      tabIndex={tabIndex}
      type="button"
      {...entryHandlers(() => instanceOf(c), c.name)}
    >
      <ComponentName className="truncate" component={c} />
    </button>
    <OpenBoard name={c.name} />
  </li>
);

/** A tile's picture area; the picture's paper only under a picture, the panel's fill otherwise. */
const TILE =
  "flex h-20 w-full items-center justify-center overflow-hidden rounded-md p-2 ring-1 ring-border ring-inset";

/**
 * A component's tile, its picture never larger than it was drawn: pictures of small nodes are
 * taken at twice their size, so half the picture's own is the component's. The picture lies on
 * the specimen paper, in its design's light look whatever the editor's theme; loading and no
 * picture are the panel's own muted fill.
 */
const Thumbnail = ({
  failed,
  name,
  src,
}: {
  /** Not drawn and not to be drawn while the grid stays open. */
  failed: boolean;
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
  if ((!src && failed) || (src && read?.src === src && read.failed)) {
    // The caption under it names the component.
    return (
      <span className={`${TILE} bg-muted`}>
        <ImageOff
          aria-hidden
          className="size-4 text-muted-foreground"
          data-no-picture
        />
      </span>
    );
  }
  if (!src || read?.src !== src) {
    return (
      <span
        className={`${TILE} animate-pulse bg-muted motion-reduce:animate-none`}
      />
    );
  }
  return (
    <span className={`${TILE} bg-specimen`}>
      <img
        alt={name}
        className="size-full object-contain"
        draggable={false}
        height={80}
        src={src}
        style={{ maxHeight: read.height, maxWidth: read.width }}
        width={160}
      />
    </span>
  );
};

/**
 * A tile: its picture and its name are one button that inserts it, and the board's chevron sits
 * beside the name, outside that button. The name starts on the list's text edge.
 */
const GridItem = ({
  component: c,
  failed,
  tabIndex,
  thumbnail,
}: {
  component: ComponentMeta;
  failed: boolean;
  tabIndex: number;
  thumbnail: string | undefined;
}) => (
  <li
    className={`group/item relative min-w-0 rounded-lg transition-colors hover:bg-accent ${ITEM_FOCUS}`}
  >
    <button
      aria-label={c.name}
      className="flex w-full min-w-0 flex-col gap-1 p-1 text-left outline-none"
      data-row
      tabIndex={tabIndex}
      type="button"
      {...entryHandlers(() => instanceOf(c), c.name)}
    >
      <Thumbnail failed={failed} name={c.name} src={thumbnail} />
      <span className="flex h-6 w-full min-w-0 items-center pr-6 pl-2">
        <ComponentName
          className="min-w-0 flex-1 truncate font-body-medium"
          component={c}
        />
      </span>
    </button>
    <span className="absolute right-1 bottom-1 flex">
      <OpenBoard name={c.name} />
    </span>
  </li>
);

/**
 * Thumbnails of the components, drawn once per design system and components and kept by the
 * server. Missing ones are drawn one at a time while the grid is open; one that draws nothing is
 * failed until the grid opens again, and with no stored ones to read every one is drawn here.
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
  // Made afresh by each read, so that the grid opened again draws again what failed.
  const [loaded, setLoaded] = useState<{ readonly key: string } | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  // What is drawn follows the names shown, not the identity of the list holding them, and skips
  // what is drawn already, as it stands when the drawing starts.
  const names = components.map((c) => c.name).join("\n");
  const missingOf = useEffectEvent((wanted: readonly string[]) =>
    components.filter(
      (c) =>
        wanted.includes(c.name) && !thumbnails[c.name] && !failed.has(c.name)
    )
  );
  const draw = useEffectEvent((c: ComponentMeta) =>
    drawSpecimen(instanceOf(c), designSystem)
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    let cancelled = false;
    // Opening the grid again tries again what failed, once the stored ones are read.
    const read = (stored: Record<string, string>) => {
      if (!cancelled) {
        setThumbnails(stored);
        setFailed(new Set());
        setLoaded({ key });
      }
    };
    api()
      .request("thumbnails.get", { key })
      .then(read)
      // None read: every one is drawn here.
      .catch(() => read({}));
    return () => {
      cancelled = true;
    };
  }, [key, active]);

  useEffect(() => {
    if (!(active && loaded?.key === key)) {
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
        const dataUrl = await draw(c).catch(() => null);
        if (cancelled) {
          return;
        }
        if (!dataUrl) {
          setFailed((f) => new Set(f).add(c.name));
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
  }, [active, loaded, key, names]);

  return { failed, thumbnails };
};

interface Section {
  readonly items: readonly ComponentMeta[];
  readonly title: string;
}

/**
 * The catalogue's components matching a search, in the Library's two sections, each by name; with
 * no search, the components placed last (`recent`, newest first) lead them as Recent, when there
 * are any.
 */
const librarySections = (
  components: readonly ComponentMeta[],
  query: string,
  recent: readonly string[] = []
): readonly Section[] => {
  const q = query.trim().toLowerCase();
  const found = components
    .filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
    )
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const placed = q
    ? []
    : recent.flatMap((name) => components.find((c) => c.name === name) ?? []);
  return [
    ...(placed.length > 0 ? [{ items: placed, title: "Recent" }] : []),
    {
      items: found.filter((c) => c.importFrom === APP_FROM),
      title: "App components",
    },
    {
      items: found.filter((c) => c.importFrom !== APP_FROM),
      title: "System components",
    },
  ];
};

/**
 * A group's name over its rows: small and muted, quieter than the names it groups, as the Design
 * system's are. The space around it is its section's and the list's gaps.
 */
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="px-4 font-body-small text-muted-foreground">{children}</h3>
);

/** A group: its name 8px over its rows; the list sets groups 24px apart. */
const SECTION = "flex flex-col gap-2";

/** The Library's scrolling list of groups. */
const GROUPS = "flex min-h-0 flex-1 flex-col gap-6 overflow-auto py-2";

/** The skeleton rows of each group while the catalogue is read, each a different length. */
const SKELETONS = [
  { rows: ["w-20"], title: "App components" },
  { rows: ["w-24", "w-16", "w-28", "w-20"], title: "System components" },
] as const;

/**
 * The catalogue not read yet: its groups' names over skeleton rows; or, when the read failed, why,
 * and Try again.
 */
const Unread = ({ failed }: { failed: boolean }) =>
  failed ? (
    <div className="mx-2 flex h-7 items-center justify-between gap-2 pl-2">
      <span className="truncate font-body-small text-muted-foreground">
        The components didn’t load
      </span>
      <Button
        onClick={() => useComponents.getState().load()}
        size="sm"
        variant="ghost"
      >
        Try again
      </Button>
    </div>
  ) : (
    SKELETONS.map((group) => (
      <section aria-busy className={SECTION} key={group.title}>
        <SectionTitle>{group.title}</SectionTitle>
        <ul>
          {group.rows.map((width) => (
            <li className="mx-2 flex h-7 items-center px-2" key={width}>
              <span
                className={`h-3 rounded-sm bg-foreground/10 motion-safe:animate-pulse ${width}`}
              />
            </li>
          ))}
        </ul>
      </section>
    ))
  );

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
  <div className="flex h-11 shrink-0 items-center pr-2 pl-4">
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
  <div className="flex shrink-0 items-center gap-2 px-2 pb-2">
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
        placeholder="Search by name or category"
        value={query}
      />
    </InputGroup>
    {onView && view ? (
      <Segmented
        className="w-auto shrink-0"
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
  tabIndex,
}: {
  children: React.ReactNode;
  item: string;
  lit: boolean;
  tabIndex?: number;
}) => (
  <button
    aria-current={lit ? "page" : undefined}
    className="mx-2 flex h-7 w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 text-left font-body-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
    data-row
    onClick={() => openBoard({ item, view: "library" })}
    tabIndex={tabIndex}
    type="button"
  >
    {children}
  </button>
);

/** A group of the navigation: one Tab stop, the arrow keys moving among its rows. */
const NavRows = ({
  items,
  open,
}: {
  items: readonly ComponentMeta[];
  open: string;
}) => {
  const roving = useRovingRows(items.length);
  return (
    <ul {...roving.list}>
      {items.map((c, i) => (
        <li key={c.name}>
          <NavRow
            item={c.name}
            lit={open === c.name}
            tabIndex={roving.tabIndexOf(i)}
          >
            <ComponentName className="truncate" component={c} />
          </NavRow>
        </li>
      ))}
    </ul>
  );
};

/**
 * Components in Design System mode (ADR 0045, 0053): the same list, now the navigation. The
 * Overview, then every component; the one open is lit.
 */
const LibraryNav = ({ open }: { open: string }) => {
  const components = useComponents((s) => s.catalogue);
  const status = useComponents((s) => s.status);
  const [query, setQuery] = useState("");
  const sections = librarySections(components, query);
  const ready = status === "ready";
  const none = sections.every((s) => s.items.length === 0);
  return (
    <div className="flex h-full flex-col">
      <Title />
      <SearchBar onQuery={setQuery} query={query} />
      <div className={GROUPS}>
        {query.trim() ? null : (
          <NavRow item={OVERVIEW} lit={open === OVERVIEW}>
            Overview
          </NavRow>
        )}
        {ready ? null : <Unread failed={status === "failed"} />}
        {ready && none && query.trim() ? (
          <NoMatch onClear={() => setQuery("")} query={query} />
        ) : null}
        {(ready ? sections : []).map((section) =>
          section.items.length === 0 ? null : (
            <section className={SECTION} key={section.title}>
              <SectionTitle>{section.title}</SectionTitle>
              <NavRows items={section.items} open={open} />
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
  const activePage = useEditor((s) => s.activePage);
  const canvas = useEditor((s) => s.canvas);
  const docs = useDocuments((s) => s.docs);
  const target = insertTarget({
    activePage,
    canvas,
    docs,
    selection,
  });
  if (!(target && selection)) {
    return null;
  }
  return (
    <p className="shrink-0 truncate border-t px-4 py-2 font-body-small text-muted-foreground">
      Inserts into <span className="text-foreground">{target.name}</span>
    </p>
  );
};

/**
 * A group of the insert list, as rows or tiles: one Tab stop, the arrow keys moving among its
 * entries.
 */
const InsertRows = ({
  failed,
  items,
  thumbnails,
  view,
}: {
  failed: ReadonlySet<string>;
  items: readonly ComponentMeta[];
  thumbnails: Readonly<Record<string, string>>;
  view: View;
}) => {
  const roving = useRovingRows(items.length, view === "grid" ? 2 : 1);
  return view === "list" ? (
    <ul {...roving.list}>
      {items.map((c, i) => (
        <ListItem
          component={c}
          key={`${c.importFrom}:${c.name}`}
          tabIndex={roving.tabIndexOf(i)}
        />
      ))}
    </ul>
  ) : (
    <ul className="grid grid-cols-2 gap-1 px-1" {...roving.list}>
      {items.map((c, i) => (
        <GridItem
          component={c}
          failed={failed.has(c.name)}
          key={`${c.importFrom}:${c.name}`}
          tabIndex={roving.tabIndexOf(i)}
          thumbnail={thumbnails[c.name]}
        />
      ))}
    </ul>
  );
};

/** The Library on a page canvas: the insert list. */
const InsertList = () => {
  const components = useComponents((s) => s.catalogue);
  const status = useComponents((s) => s.status);
  const recent = useRecentComponents();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(storedView);
  const sections = librarySections(components, query, recent);
  // Recent's are drawn once, in their own group's place.
  const { failed, thumbnails } = useThumbnails(
    sections.flatMap((s) => (s.title === "Recent" ? [] : s.items)),
    view === "grid"
  );
  const ready = status === "ready";
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
      <div className={GROUPS}>
        {ready ? null : <Unread failed={status === "failed"} />}
        {ready && none && searching ? (
          <NoMatch onClear={() => setQuery("")} query={query} />
        ) : null}
        {(ready ? sections : []).map((section) => {
          const empty = section.items.length === 0;
          // App components keep their place, empty, until there are some to search.
          if (empty && (searching || section.title !== "App components")) {
            return null;
          }
          return (
            <section className={SECTION} key={section.title}>
              <SectionTitle>{section.title}</SectionTitle>
              {empty ? (
                <NoAppComponents />
              ) : (
                <InsertRows
                  failed={failed}
                  items={section.items}
                  thumbnails={thumbnails}
                  view={view}
                />
              )}
            </section>
          );
        })}
      </div>
      <InsertHint />
    </div>
  );
};
