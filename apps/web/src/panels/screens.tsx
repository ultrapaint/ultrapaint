import type { Screen } from "@ultrapaint/contracts/screens";
import { cn } from "cn";
import { Copy, FilePlus2, FolderOpen, Pencil, Trash2 } from "lucide-react";
import {
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent,
  type SetStateAction,
  useEffect,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmDialog } from "../components/dialogs.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";

interface Renaming {
  id: string;
  name: string;
}

export const Screens = () => {
  const screens = useProject((s) => s.screens);
  const configured = useProject((s) => s.info.configured);
  const flow = useEditor((s) => s.flow);
  const activeScreen = useEditor((s) => s.activeScreen);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [newFlow, setNewFlow] = useState("");
  const [template, setTemplate] = useState("centered");
  const [templates, setTemplates] = useState<
    readonly { id: string; name: string }[]
  >([]);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const flows = Array.from(new Set(screens.map((s) => s.flow))).sort();

  useEffect(() => {
    if (!configured) {
      return;
    }
    api()
      .request("screens.templates", undefined)
      .then(setTemplates)
      .catch(() => undefined);
  }, [configured]);

  const create = async () => {
    const targetFlow = (newFlow || flow || "").trim();
    const screenName = name || "screen";
    try {
      const s = await api().request("screens.create", {
        flow: targetFlow,
        name: screenName,
        template,
      });
      setCreating(false);
      setName("");
      if (targetFlow !== flow) {
        await useEditor.getState().openFlow(targetFlow);
      }
      useEditor.getState().setActiveScreen(s.id);
    } catch (error) {
      reportError(error);
    }
  };

  const toggleCreating = () => setCreating((c) => !c);
  const cancelCreating = () => setCreating(false);
  const onNameChange = (e: ChangeEvent<HTMLInputElement>) =>
    setName(e.target.value);
  const onNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      create();
    }
  };
  const onNewFlowChange = (e: ChangeEvent<HTMLInputElement>) =>
    setNewFlow(e.target.value);

  if (!configured) {
    return <PanelEmpty>Configure a repository in settings</PanelEmpty>;
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <span className="flex-1 text-[11px] text-muted-foreground">Flows</span>
        <IconButton onClick={toggleCreating} tooltip="New screen">
          <FilePlus2 />
        </IconButton>
      </div>
      {creating ? (
        <div className="flex flex-col gap-1.5 border-b bg-muted/30 p-2">
          <Input
            autoFocus
            onChange={onNameChange}
            onKeyDown={onNameKeyDown}
            placeholder="Screen name"
            value={name}
          />
          <Input
            onChange={onNewFlowChange}
            placeholder={`Flow (default: ${flow || "root"})`}
            value={newFlow}
          />
          <OptionSelect
            onChange={setTemplate}
            options={templates.map((t) => ({ label: t.name, value: t.id }))}
            value={template}
          />
          <div className="flex justify-end gap-1">
            <Button onClick={cancelCreating} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button onClick={create} size="sm">
              Create
            </Button>
          </div>
        </div>
      ) : null}
      {flows.map((f) => (
        <div key={f || "(root)"}>
          <FlowButton
            active={f === flow}
            count={screens.filter((s) => s.flow === f).length}
            flow={f}
          />
          {f === flow
            ? screens
                .filter((s) => s.flow === f)
                .map((s) => (
                  <ScreenRow
                    active={activeScreen === s.id}
                    key={s.id}
                    renaming={renaming?.id === s.id ? renaming : null}
                    screen={s}
                    setRenaming={setRenaming}
                  />
                ))
            : null}
        </div>
      ))}
      {flows.length === 0 && (
        <PanelEmpty>No screens yet. Create one to start.</PanelEmpty>
      )}
    </div>
  );
};

const FlowButton = ({
  flow,
  active,
  count,
}: {
  flow: string;
  active: boolean;
  count: number;
}) => {
  const open = () => useEditor.getState().openFlow(flow);
  return (
    <Button
      className={cn(
        "w-full justify-start gap-1.5 rounded-none font-normal text-[11px] active:translate-y-0",
        !active && "text-muted-foreground"
      )}
      onClick={open}
      variant="ghost"
    >
      <FolderOpen className="text-muted-foreground" />
      <span className="flex-1 truncate text-left">{flow || "(root)"}</span>
      <span className="text-muted-foreground">{count}</span>
    </Button>
  );
};

const ScreenRow = ({
  screen,
  active,
  renaming,
  setRenaming,
}: {
  screen: Screen;
  active: boolean;
  /** Set while this row is the one being renamed. */
  renaming: Renaming | null;
  setRenaming: Dispatch<SetStateAction<Renaming | null>>;
}) => {
  const { id, name } = screen;
  const renamingTo = renaming?.name;

  const activate = () => {
    useEditor.getState().setActiveScreen(id);
    useEditor.getState().select(null);
  };
  const stopRenaming = () => setRenaming(null);
  const onRenameChange = (e: ChangeEvent<HTMLInputElement>) =>
    setRenaming({ id, name: e.target.value });
  const onRenameKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setRenaming(null);
    }
    if (e.key === "Enter" && renamingTo !== undefined) {
      try {
        await api().request("screens.rename", { id, name: renamingTo });
      } catch (error) {
        reportError(error);
      }
      setRenaming(null);
    }
  };
  const startRenaming = (e: MouseEvent) => {
    e.stopPropagation();
    setRenaming({ id, name });
  };
  const duplicate = (e: MouseEvent) => {
    e.stopPropagation();
    api().request("screens.duplicate", { id }).catch(reportError);
  };
  const remove = async (e: MouseEvent) => {
    e.stopPropagation();
    const ok = await confirmDialog({
      confirmLabel: "Delete",
      description: "The screen file is removed from the designs directory.",
      destructive: true,
      title: `Delete ${name}?`,
    });
    if (ok) {
      api().request("screens.delete", { id }).catch(reportError);
    }
  };

  return (
    <div
      className={cn(
        "group flex h-6 items-center gap-1 pr-1 pl-7 text-[11px]",
        active
          ? "bg-brand/20 text-foreground"
          : "text-muted-foreground hover:bg-muted/50"
      )}
    >
      {renaming ? (
        <Input
          autoFocus
          className="h-5"
          onBlur={stopRenaming}
          onChange={onRenameChange}
          onClick={activate}
          onKeyDown={onRenameKeyDown}
          value={renaming.name}
        />
      ) : (
        // Stretches over the row's left padding so the whole row stays clickable.
        <button
          className="-ml-7 h-full min-w-0 flex-1 truncate pl-7 text-left"
          onClick={activate}
          type="button"
        >
          {name}
        </button>
      )}
      <span className="hidden items-center group-hover:flex">
        <IconButton onClick={startRenaming} size="icon-xs" tooltip="Rename">
          <Pencil className="size-3" />
        </IconButton>
        <IconButton onClick={duplicate} size="icon-xs" tooltip="Duplicate">
          <Copy className="size-3" />
        </IconButton>
        <IconButton onClick={remove} size="icon-xs" tooltip="Delete">
          <Trash2 className="size-3" />
        </IconButton>
      </span>
    </div>
  );
};
