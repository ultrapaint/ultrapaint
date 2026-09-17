import { Copy, FilePlus2, FolderOpen, Pencil, Trash2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmDialog } from "../components/dialogs.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { cn } from "../lib/utils.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";

export const Screens = () => {
  const screens = useProject((s) => s.screens);
  const configured = useProject((s) => s.info.configured);
  const flow = useEditor((s) => s.flow);
  const activeScreen = useEditor((s) => s.activeScreen);
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");
  const [newFlow, setNewFlow] = React.useState("");
  const [template, setTemplate] = React.useState("centered");
  const [templates, setTemplates] = React.useState<readonly { id: string; name: string }[]>([]);
  const [renaming, setRenaming] = React.useState<{ id: string; name: string } | null>(null);
  const flows = Array.from(new Set(screens.map((s) => s.flow))).sort();

  React.useEffect(() => {
    if (!configured) return;
    api()
      .request("screens.templates", undefined)
      .then(setTemplates)
      .catch(() => undefined);
  }, [configured]);

  if (!configured) return <PanelEmpty>Configure a repository in settings</PanelEmpty>;

  const create = async () => {
    const targetFlow = (newFlow || flow || "").trim();
    try {
      const s = await api().request("screens.create", {
        flow: targetFlow,
        name: name || "screen",
        template,
      });
      setCreating(false);
      setName("");
      if (targetFlow !== flow) await useEditor.getState().openFlow(targetFlow);
      useEditor.getState().setActiveScreen(s.id);
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <span className="flex-1 text-[11px] text-muted-foreground">Flows</span>
        <IconButton tooltip="New screen" onClick={() => setCreating((c) => !c)}>
          <FilePlus2 />
        </IconButton>
      </div>
      {creating && (
        <div className="flex flex-col gap-1.5 border-b bg-muted/30 p-2">
          <Input
            placeholder="Screen name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <Input
            placeholder={`Flow (default: ${flow || "root"})`}
            value={newFlow}
            onChange={(e) => setNewFlow(e.target.value)}
          />
          <OptionSelect
            value={template}
            onChange={setTemplate}
            options={templates.map((t) => ({ value: t.id, label: t.name }))}
          />
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={create}>
              Create
            </Button>
          </div>
        </div>
      )}
      {flows.map((f) => (
        <div key={f || "(root)"}>
          <Button
            variant="ghost"
            className={cn(
              "w-full justify-start gap-1.5 rounded-none font-normal text-[11px] active:translate-y-0",
              f !== flow && "text-muted-foreground",
            )}
            onClick={() => useEditor.getState().openFlow(f)}
          >
            <FolderOpen className="text-muted-foreground" />
            <span className="flex-1 truncate text-left">{f || "(root)"}</span>
            <span className="text-muted-foreground">
              {screens.filter((s) => s.flow === f).length}
            </span>
          </Button>
          {f === flow &&
            screens
              .filter((s) => s.flow === f)
              .map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    "group flex h-6 items-center gap-1 pr-1 pl-7 text-[11px]",
                    activeScreen === s.id
                      ? "bg-brand/20 text-foreground"
                      : "text-muted-foreground hover:bg-muted/50",
                  )}
                  onClick={() => {
                    useEditor.getState().setActiveScreen(s.id);
                    useEditor.getState().select(null);
                  }}
                >
                  {renaming?.id === s.id ? (
                    <Input
                      className="h-5"
                      autoFocus
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: s.id, name: e.target.value })}
                      onBlur={() => setRenaming(null)}
                      onKeyDown={async (e) => {
                        if (e.key === "Escape") setRenaming(null);
                        if (e.key === "Enter") {
                          try {
                            await api().request("screens.rename", {
                              id: s.id,
                              name: renaming.name,
                            });
                          } catch (error) {
                            reportError(error);
                          }
                          setRenaming(null);
                        }
                      }}
                    />
                  ) : (
                    <span className="flex-1 truncate">{s.name}</span>
                  )}
                  <span className="hidden items-center group-hover:flex">
                    <IconButton
                      size="icon-xs"
                      tooltip="Rename"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenaming({ id: s.id, name: s.name });
                      }}
                    >
                      <Pencil className="size-3" />
                    </IconButton>
                    <IconButton
                      size="icon-xs"
                      tooltip="Duplicate"
                      onClick={(e) => {
                        e.stopPropagation();
                        api().request("screens.duplicate", { id: s.id }).catch(reportError);
                      }}
                    >
                      <Copy className="size-3" />
                    </IconButton>
                    <IconButton
                      size="icon-xs"
                      tooltip="Delete"
                      onClick={async (e) => {
                        e.stopPropagation();
                        const ok = await confirmDialog({
                          title: `Delete ${s.name}?`,
                          description: "The screen file is removed from the designs directory.",
                          confirmLabel: "Delete",
                          destructive: true,
                        });
                        if (ok) api().request("screens.delete", { id: s.id }).catch(reportError);
                      }}
                    >
                      <Trash2 className="size-3" />
                    </IconButton>
                  </span>
                </div>
              ))}
        </div>
      ))}
      {flows.length === 0 && <PanelEmpty>No screens yet. Create one to start.</PanelEmpty>}
    </div>
  );
};
