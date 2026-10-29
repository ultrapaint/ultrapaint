/**
 * What can be put on the design: the format's own nodes (rows, columns, text, images) and the
 * design system's components, as a list or as a grid of thumbnails. A click inserts into the
 * selection; a drag puts it anywhere, on a page or on the canvas.
 */
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  ELEMENTS,
  type ElementId,
  newElement,
  newInstance,
} from "@ultrapaint/design-document/factories";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import {
  ArrowDown,
  ArrowRight,
  Group,
  Heading,
  Image,
  LayoutGrid,
  List,
  Search,
  Type,
} from "lucide-react";
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
import { useProject } from "../state/project.ts";
import { ensureEditable } from "../state/setup.ts";

type View = "list" | "grid";
const VIEW_KEY = "ultrapaint:assets-view";

const ELEMENT_ICONS: Record<ElementId, React.ReactNode> = {
  column: <ArrowDown className="size-3.5" />,
  group: <Group className="size-3.5" />,
  heading: <Heading className="size-3.5" />,
  image: <Image className="size-3.5" />,
  paragraph: <Type className="size-3.5" />,
  row: <ArrowRight className="size-3.5" />,
};

const VOWEL_RE = /^[aeiou]/;

/** "a row", "an image". */
const articled = (noun: string) =>
  `${VOWEL_RE.test(noun) ? "an" : "a"} ${noun}`;

/** Ids are the server's to settle; these only have to be unique within the node. */
const nextId = () => makeIdGenerator();

const instanceOf = (c: ComponentMeta) =>
  newInstance(
    c,
    useDesignSystem.getState().designSystem?.components?.[c.name],
    nextId()
  );

/**
 * Everything an entry of the Assets panel does: a click inserts, a drag carries the node, a
 * right-click offers where else it can go.
 */
const entryHandlers = (
  make: () => DesignNode,
  name: string,
  isComponent: boolean
) => ({
  draggable: true,
  onClick: () => insertNode(make()),
  onContextMenu: (e: React.MouseEvent) =>
    openMenuAt(e, { isComponent, kind: "component", make, name }),
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

const Elements = () => (
  <div className="grid grid-cols-3 gap-1 border-b p-2">
    {ELEMENTS.map((p) => (
      <button
        className="flex flex-col items-center gap-1 rounded-md border bg-background/40 px-1 py-2 font-body text-muted-foreground hover:border-ring hover:text-foreground"
        key={p.id}
        title={`Insert ${articled(p.name.toLowerCase())}`}
        type="button"
        {...entryHandlers(() => newElement(p.id, nextId()), p.name, false)}
      >
        {ELEMENT_ICONS[p.id]}
        {p.name}
      </button>
    ))}
  </div>
);

const ListItem = ({ component: c }: { component: ComponentMeta }) => (
  <button
    className="flex h-7 w-full items-center gap-2 px-3 text-left font-body text-muted-foreground hover:bg-muted/60 hover:text-foreground"
    title={c.description ?? c.importFrom}
    type="button"
    {...entryHandlers(() => instanceOf(c), c.name, true)}
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
    {...entryHandlers(() => instanceOf(c), c.name, true)}
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
  const { components: files, styles } = useDesignLook();
  const key = hashOf(
    `${JSON.stringify(designSystem?.components ?? {})}:${JSON.stringify(designSystem?.colors ?? [])}:${styles}:${JSON.stringify(files)}`
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

/** Category of a component: what init said, else what the catalogue guessed from its path. */
const categoryOf = (
  c: ComponentMeta,
  ds: ReturnType<typeof useDesignSystem.getState>["designSystem"]
) => ds?.components?.[c.name]?.category ?? c.category;

export const Assets = () => {
  const configured = useProject((s) => s.info.configured);
  const components = useComponents((s) => s.catalogue);
  // The target is worked out from the selection and the documents.
  const selection = useEditor((s) => s.selection);
  const selectedPage = useEditor((s) => s.selectedPage);
  const activePage = useEditor((s) => s.activePage);
  const canvas = useEditor((s) => s.canvas);
  const docs = useDocuments((s) => s.docs);
  const designSystem = useDesignSystem((s) => s.designSystem);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(
    () => (localStorage.getItem(VIEW_KEY) as View | null) ?? "list"
  );
  const q = query.trim().toLowerCase();
  const list = components.filter(
    (c) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      categoryOf(c, designSystem).toLowerCase().includes(q)
  );
  const thumbnails = useThumbnails(list, view === "grid");

  const onView = (next: View) => {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  };

  if (!configured) {
    return <SetupEmpty />;
  }

  // The system components, then the project's own (ADR 0041), each by category.
  const sections = [
    {
      items: list.filter((c) => c.importFrom !== APP_FROM),
      title: "System",
    },
    { items: list.filter((c) => c.importFrom === APP_FROM), title: "App" },
  ].map(({ items, title }) => {
    const byCategory = new Map<string, ComponentMeta[]>();
    for (const c of items) {
      const category = categoryOf(c, designSystem);
      byCategory.set(category, [...(byCategory.get(category) ?? []), c]);
    }
    return { byCategory, count: items.length, title };
  });
  const target = insertTarget({
    activePage,
    canvas,
    docs,
    selectedPage,
    selection,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets…"
            value={query}
          />
        </InputGroup>
        <div className="w-16 shrink-0">
          <Segmented
            onChange={onView}
            options={[
              {
                label: <List className="size-3" />,
                title: "List",
                value: "list",
              },
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
      <div className="border-b px-2 py-1 font-body text-muted-foreground">
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
      <div className="min-h-0 flex-1 overflow-auto">
        {!q && <Elements />}
        {sections.map((section) => (
          <section key={section.title}>
            <div className="border-t px-2 pt-2 pb-1 font-medium text-foreground">
              {section.title}
            </div>
            {section.count === 0 && section.title === "App" && !q ? (
              <p className="px-2 pb-2 font-body text-muted-foreground">
                Your own components. Select part of a page and choose "Make an
                app component…" in its menu.
              </p>
            ) : null}
            {Array.from(section.byCategory.entries()).map(
              ([category, items]) => (
                <div key={category}>
                  {/* An app component no category is given is the section's own. */}
                  {category === section.title ? null : (
                    <div className="sticky top-0 z-10 bg-sidebar px-2 py-1 font-heading-xsmall text-muted-foreground uppercase">
                      {category}
                    </div>
                  )}
                  {view === "list" ? (
                    items.map((c) => (
                      <ListItem
                        component={c}
                        key={`${c.importFrom}:${c.name}`}
                      />
                    ))
                  ) : (
                    <div className="grid grid-cols-2 gap-1.5 px-2 pb-2">
                      {items.map((c) => (
                        <GridItem
                          component={c}
                          key={`${c.importFrom}:${c.name}`}
                          thumbnail={thumbnails[c.name]}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
          </section>
        ))}
      </div>
    </div>
  );
};
