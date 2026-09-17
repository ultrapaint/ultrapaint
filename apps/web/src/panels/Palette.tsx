import type { ComponentMeta } from "@ultrapaint/contracts";
import { RefreshCw, Search } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { IconButton } from "../components/icon-button.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { runEdit } from "../lib/shortcuts.ts";
import { cn } from "../lib/utils.ts";
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

  if (!configured) return <PanelEmpty>Configure a repository first</PanelEmpty>;
  if (!catalogue)
    return <PanelEmpty>{loading ? "Indexing the design system…" : "No catalogue"}</PanelEmpty>;

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
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search components…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
        <IconButton tooltip="Re-index" onClick={() => load(true)} disabled={loading}>
          <RefreshCw className={cn(loading && "animate-spin")} />
        </IconButton>
      </div>
      <div className="border-b px-2 py-1 text-[10px] text-muted-foreground">
        {target ? (
          <>
            Click to insert into{" "}
            <span className="text-foreground">
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
            <div className="sticky top-0 z-10 bg-sidebar px-2 py-1 font-medium text-[10px] text-muted-foreground uppercase">
              {cat}
            </div>
            {comps.map((c) => (
              <Button
                variant="ghost"
                size="sm"
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
                className="w-full justify-start gap-2 rounded-none font-normal text-[11px] text-muted-foreground active:translate-y-0"
                title={c.description ?? c.snippet}
              >
                <span className="truncate">{c.name}</span>
                <span className="ml-auto truncate text-[10px] text-muted-foreground/70">
                  {Object.keys(c.variants).join(" · ")}
                </span>
              </Button>
            ))}
          </div>
        ))}
      </div>
      {preview && (
        <div className="border-t p-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-medium">{preview.name}</span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {preview.importFrom}
            </span>
          </div>
          {storyUrl ? (
            <iframe
              title={preview.name}
              src={storyUrl}
              className="h-32 w-full rounded-md border bg-white"
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
                  key={p.name}
                  variant="secondary"
                  className="rounded-sm px-1.5 font-mono"
                  title={p.type.raw}
                >
                  {p.name}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
