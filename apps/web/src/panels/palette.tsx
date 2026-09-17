import type { SourceLocation } from "@ultrapaint/contracts/base";
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import { cn } from "cn";
import { RefreshCw, Search } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { IconButton } from "../components/icon-button.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { runEdit } from "../lib/shortcuts.ts";
import { useCatalogue } from "../state/catalogue.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";

const insert = async (c: ComponentMeta, target: SourceLocation | null) => {
  if (!target) {
    return;
  }
  const r = await runEdit({
    imports: [{ from: c.importFrom, name: c.name }],
    index: 9999,
    into: target,
    jsx: c.snippet,
    kind: "insert",
  });
  const s = useEditor.getState();
  if (r?.location && s.selection) {
    s.select({
      nodeId: s.selection.nodeId,
      screenId: s.selection.screenId,
      source: r.location,
    });
  }
};

const PaletteItem = ({
  component: c,
  target,
  onPreview,
}: {
  component: ComponentMeta;
  target: SourceLocation | null;
  onPreview: (c: ComponentMeta) => void;
}) => {
  const onClick = useCallback(() => insert(c, target), [c, target]);
  const onDragStart = useCallback(
    (e: React.DragEvent) =>
      e.dataTransfer.setData(
        "application/ultrapaint-component",
        JSON.stringify({
          importFrom: c.importFrom,
          name: c.name,
          snippet: c.snippet,
        })
      ),
    [c]
  );
  const onMouseEnter = useCallback(() => onPreview(c), [c, onPreview]);
  return (
    <Button
      className="w-full justify-start gap-2 rounded-none font-normal text-[11px] text-muted-foreground active:translate-y-0"
      disabled={!target}
      draggable
      onClick={onClick}
      onDragStart={onDragStart}
      onMouseEnter={onMouseEnter}
      size="sm"
      title={c.description ?? c.snippet}
      variant="ghost"
    >
      <span className="truncate">{c.name}</span>
      <span className="ml-auto truncate text-[10px] text-muted-foreground/70">
        {Object.keys(c.variants).join(" · ")}
      </span>
    </Button>
  );
};

export const Palette = () => {
  const configured = useProject((s) => s.info.configured);
  const { catalogue, loading, load } = useCatalogue();
  const selection = useEditor((s) => s.selection);
  const inspect = useEditor((s) => s.inspect);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<ComponentMeta | null>(null);
  const [storyUrl, setStoryUrl] = useState<string | null>(null);

  useEffect(() => {
    if (configured && !catalogue && !loading) {
      load();
    }
  }, [configured, catalogue, loading, load]);

  useEffect(() => {
    const id = preview?.storyIds[0];
    if (!id) {
      setStoryUrl(null);
      return;
    }
    api()
      .request("catalogue.storyUrl", { storyId: id })
      .then(setStoryUrl)
      .catch(() => setStoryUrl(null));
  }, [preview]);

  const onQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
    []
  );
  const reindex = useCallback(() => load(true), [load]);

  if (!configured) {
    return <PanelEmpty>Configure a repository first</PanelEmpty>;
  }
  if (!catalogue) {
    return (
      <PanelEmpty>
        {loading ? "Indexing the design system…" : "No catalogue"}
      </PanelEmpty>
    );
  }

  const q = query.trim().toLowerCase();
  const list = catalogue.components.filter(
    (c) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q)
  );
  const byCategory = new Map<string, ComponentMeta[]>();
  for (const c of list) {
    byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c]);
  }
  const target =
    selection?.source && inspect?.editable
      ? selection.source
      : (inspect?.editableAncestor?.source ?? null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            onChange={onQueryChange}
            placeholder="Search components…"
            value={query}
          />
        </InputGroup>
        <IconButton disabled={loading} onClick={reindex} tooltip="Re-index">
          <RefreshCw className={cn(loading && "animate-spin")} />
        </IconButton>
      </div>
      <div className="border-b px-2 py-1 text-[10px] text-muted-foreground">
        {target ? (
          <>
            Click to insert into{" "}
            <span className="text-foreground">
              {inspect?.editable
                ? inspect.name
                : inspect?.editableAncestor?.name}
            </span>
          </>
        ) : (
          "Select an editable element on the canvas to insert into"
        )}
        <span className="float-right">
          {catalogue.coverage.usable}/{catalogue.coverage.total}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {Array.from(byCategory.entries()).map(([cat, comps]) => (
          <div key={cat}>
            <div className="sticky top-0 z-10 bg-sidebar px-2 py-1 font-medium text-[10px] text-muted-foreground uppercase">
              {cat}
            </div>
            {comps.map((c) => (
              <PaletteItem
                component={c}
                key={`${c.group}:${c.name}`}
                onPreview={setPreview}
                target={target}
              />
            ))}
          </div>
        ))}
      </div>
      {preview ? (
        <div className="border-t p-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-medium">{preview.name}</span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {preview.importFrom}
            </span>
          </div>
          {storyUrl ? (
            <iframe
              className="h-32 w-full rounded-md border bg-white"
              src={storyUrl}
              title={preview.name}
            />
          ) : (
            <pre className="max-h-24 overflow-auto rounded-md bg-muted/50 p-1.5 font-mono text-[10px] text-muted-foreground">
              {preview.snippet}
            </pre>
          )}
          {preview.props.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {preview.props.slice(0, 8).map((p) => (
                <Badge
                  className="rounded-sm px-1.5 font-mono"
                  key={p.name}
                  title={p.type.raw}
                  variant="secondary"
                >
                  {p.name}
                </Badge>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};
