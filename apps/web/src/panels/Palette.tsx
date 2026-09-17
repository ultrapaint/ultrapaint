import type { ComponentMeta } from "@ultrapaint/contracts";
import { RefreshCw, Search } from "lucide-react";
import * as React from "react";
import { Empty, IconButton, Input } from "../components/ui.tsx";
import { cn } from "../lib/cn.ts";
import { runEdit } from "../lib/shortcuts.ts";
import { useCatalogue } from "../state/catalogue.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";

export const Palette = () => {
  const configured = useProject((s) => s.info.configured);
  const { catalogue, loading, load } = useCatalogue();
  const selection = useEditor((s) => s.selection);
  const inspect = useEditor((s) => s.inspect);
  const [query, setQuery] = React.useState("");
  const [preview, setPreview] = React.useState<ComponentMeta | null>(null);
  const [storyUrl, setStoryUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (configured && !catalogue && !loading) void load();
  }, [configured, catalogue, loading, load]);

  React.useEffect(() => {
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

  if (!configured) return <Empty>Configure a repository first</Empty>;
  if (!catalogue) return <Empty>{loading ? "Indexing the design system…" : "No catalogue"}</Empty>;

  const q = query.trim().toLowerCase();
  const list = catalogue.components.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q),
  );
  const byCategory = new Map<string, ComponentMeta[]>();
  for (const c of list) byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c]);
  const target =
    selection?.source && inspect?.editable
      ? selection.source
      : (inspect?.editableAncestor?.source ?? null);

  const insert = async (c: ComponentMeta) => {
    if (!target) return;
    const r = await runEdit({
      kind: "insert",
      into: target,
      index: 9999,
      jsx: c.snippet,
      imports: [{ name: c.name, from: c.importFrom }],
    });
    const s = useEditor.getState();
    if (r?.location && s.selection)
      s.select({ screenId: s.selection.screenId, nodeId: s.selection.nodeId, source: r.location });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-line border-b px-2 py-1.5">
        <Search className="size-3.5 text-ink-3" />
        <Input
          className="h-6 border-transparent bg-transparent"
          placeholder="Search components…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <IconButton title="Re-index" onClick={() => load(true)} disabled={loading}>
          <RefreshCw className={cn("size-3", loading && "animate-spin")} />
        </IconButton>
      </div>
      <div className="border-line border-b px-2 py-1 text-[10px] text-ink-3">
        {target ? (
          <>
            Click to insert into{" "}
            <span className="text-ink">
              {inspect?.editable ? inspect.name : inspect?.editableAncestor?.name}
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
            <div className="sticky top-0 bg-panel px-2 py-1 font-medium text-[10px] text-ink-3 uppercase">
              {cat}
            </div>
            {comps.map((c) => (
              <button
                type="button"
                key={`${c.group}:${c.name}`}
                disabled={!target}
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData(
                    "application/ultrapaint-component",
                    JSON.stringify({ name: c.name, importFrom: c.importFrom, snippet: c.snippet }),
                  )
                }
                onClick={() => insert(c)}
                onMouseEnter={() => setPreview(c)}
                className="flex h-6 w-full items-center gap-2 px-2 text-left text-[11px] text-ink-2 hover:bg-panel-2 hover:text-ink disabled:opacity-50"
                title={c.description ?? c.snippet}
              >
                <span className="truncate">{c.name}</span>
                <span className="ml-auto truncate text-[10px] text-ink-3">
                  {Object.keys(c.variants).join(" · ")}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {preview && (
        <div className="border-line border-t p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium text-ink">{preview.name}</span>
            <span className="truncate font-mono text-[10px] text-ink-3">{preview.importFrom}</span>
          </div>
          {storyUrl ? (
            <iframe
              title={preview.name}
              src={storyUrl}
              className="h-32 w-full rounded border border-line bg-white"
            />
          ) : (
            <pre className="max-h-24 overflow-auto rounded bg-panel-2 p-1.5 font-mono text-[10px] text-ink-2">
              {preview.snippet}
            </pre>
          )}
          {preview.props.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {preview.props.slice(0, 8).map((p) => (
                <span
                  key={p.name}
                  className="rounded bg-panel-3 px-1 font-mono text-[10px] text-ink-3"
                  title={p.type.raw}
                >
                  {p.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
