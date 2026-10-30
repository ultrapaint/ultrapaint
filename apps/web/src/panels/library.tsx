/**
 * The Library (ADR 0045): the components a design places, the App components then the System
 * components, as a list or as a grid of thumbnails. On a page canvas it is the insert list: a
 * click inserts into the selection, a drag puts one anywhere, on a page or on the canvas. The
 * elements (rows, columns, text, images) are the tools' Insert menu's.
 */
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { newInstance } from "@ultrapaint/design-document/factories";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import { LayoutGrid, List, Palette, Search } from "lucide-react";
import type * as React from "react";
import { useEffect, useEffectEvent, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ASSET_MIME, beginDrag, cancelDrag, useDrag } from "../canvas/drag.ts";
import { drawSpecimen, hashOf } from "../canvas/specimens.ts";
import { Segmented } from "../components/segmented.tsx";
import { SetupEmpty } from "../components/setup-dialog.tsx";
import { insertNode, insertTarget } from "../lib/node-actions.ts";
import { useComponents } from "../state/components.ts";
import { api } from "../state/connection.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useDesignLook } from "../state/look.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { ensureEditable } from "../state/setup.ts";

type View = "list" | "grid";
const VIEW_KEY = "ultrapaint:library-view";
/** Where the choice was kept while the list was the Assets panel's. */
const FORMER_VIEW_KEY = "ultrapaint:assets-view";

const storedView = (): View => {
  const stored =
    localStorage.getItem(VIEW_KEY) ?? localStorage.getItem(FORMER_VIEW_KEY);
  return stored === "grid" ? "grid" : "list";
};

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
    openMenuAt(e, { isComponent: true, kind: "component", make, name }),
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
    e.dataTransfer.setData(ASSET_MIME, JSON.stringify(make()));
    beginDrag({ kind: "new", name }, e.clientX, e.clientY, false);
  },
});

const ListItem = ({ component: c }: { component: ComponentMeta }) => (
  <button
    className="flex h-7 w-full items-center gap-2 px-3 text-left font-body text-muted-foreground hover:bg-muted/60 hover:text-foreground"
    title={c.description ?? c.importFrom}
    type="button"
    {...entryHandlers(() => instanceOf(c), c.name)}
  >
    <span className="truncate font-medium text-foreground/90">{c.name}</span>
    <span className="ml-auto truncate font-body text-muted-foreground/70">
      {Object.keys(c.variants).join(" · ")}
    </span>
  </button>
);

const GridItem = ({
  component: c,
  thumbnail,
}: {
  component: ComponentMeta;
  thumbnail: string | undefined;
}) => (
  <button
    className="group flex min-w-0 flex-col overflow-hidden rounded-md border bg-background/40 text-left hover:border-ring"
    title={c.description ?? c.importFrom}
    type="button"
    {...entryHandlers(() => instanceOf(c), c.name)}
  >
    <span className="flex h-20 items-center justify-center overflow-hidden bg-white p-2">
      {thumbnail ? (
        <img
          alt=""
          className="size-full object-contain"
          draggable={false}
          height={80}
          src={thumbnail}
          width={160}
        />
      ) : (
        <span className="size-full animate-pulse rounded bg-zinc-100" />
      )}
    </span>
    <span className="truncate border-t px-2 py-1 font-body text-foreground/90">
      {c.name}
    </span>
  </button>
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
export const librarySections = (
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

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <div className="px-3 pt-3 pb-1 font-heading-xsmall text-muted-foreground">
    {children}
  </div>
);

/** The search and the list or grid choice, at the head of the Library. */
const SearchBar = ({
  onQuery,
  onView,
  query,
  view,
}: {
  onQuery: (query: string) => void;
  onView: (view: View) => void;
  query: string;
  view: View;
}) => (
  <div className="flex items-center gap-1 px-2 pb-1.5">
    <InputGroup>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search components…"
        value={query}
      />
    </InputGroup>
    <div className="w-16 shrink-0">
      <Segmented
        onChange={onView}
        options={[
          { label: <List className="size-3" />, title: "List", value: "list" },
          {
            label: <LayoutGrid className="size-3" />,
            title: "Grid",
            value: "grid",
          },
        ]}
        value={view}
      />
    </div>
  </div>
);

/** The quiet way from the components to the values they are drawn with. */
const ToDesignSystem = () => (
  <p className="shrink-0 border-t px-3 py-2 font-body text-muted-foreground">
    <Palette className="mr-1.5 inline size-3 align-[-0.125em]" />
    Colours, type and spacing are in{" "}
    <button
      className="text-foreground hover:underline"
      onClick={() => showLeftPanel("designSystem")}
      type="button"
    >
      Design system
    </button>
  </p>
);

export const Library = () => {
  const configured = useProject((s) => s.info.configured);
  const components = useComponents((s) => s.catalogue);
  // The target is worked out from the selection and the documents.
  const selection = useEditor((s) => s.selection);
  const selectedPage = useEditor((s) => s.selectedPage);
  const activePage = useEditor((s) => s.activePage);
  const canvas = useEditor((s) => s.canvas);
  const docs = useDocuments((s) => s.docs);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(storedView);
  const sections = librarySections(components, query);
  const thumbnails = useThumbnails(
    sections.flatMap((s) => s.items),
    view === "grid"
  );

  const onView = (next: View) => {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  };

  if (!configured) {
    return <SetupEmpty />;
  }

  const target = insertTarget({
    activePage,
    canvas,
    docs,
    selectedPage,
    selection,
  });

  return (
    <div className="flex h-full flex-col">
      <SearchBar onQuery={setQuery} onView={onView} query={query} view={view} />
      <div className="border-b px-3 pb-1.5 font-body text-muted-foreground">
        {target ? (
          <>
            Click to insert into{" "}
            <span className="text-foreground">{target.name}</span>, or drag
            anywhere
          </>
        ) : (
          "Drag onto a page or the canvas"
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {sections.map((section) => (
          <section key={section.title}>
            <SectionTitle>{section.title}</SectionTitle>
            {section.items.length === 0 &&
            section.title === "App components" &&
            !query.trim() ? (
              <p className="px-3 pb-2 font-body text-muted-foreground">
                None yet. Select part of a page and choose "Make an app
                component…" in its menu.
              </p>
            ) : null}
            {view === "list" ? (
              section.items.map((c) => (
                <ListItem component={c} key={`${c.importFrom}:${c.name}`} />
              ))
            ) : (
              <div className="grid grid-cols-2 gap-1.5 px-2">
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
        ))}
      </div>
      <ToDesignSystem />
    </div>
  );
};
