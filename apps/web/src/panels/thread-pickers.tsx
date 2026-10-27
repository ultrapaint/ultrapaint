/**
 * The composer's pickers: the agent, its model and options, and its mode, as the agent offers
 * them.
 */
import {
  type ConfigOption,
  defaultChoice,
  isBusy,
  isEffortOption,
  isModelOption,
  namedChoices,
  type Thread,
  withNamedChoices,
} from "@ultrapaint/contracts/threads";
import { cn } from "cn";
import {
  ChevronDown,
  Eye,
  FilePen,
  FolderPen,
  Hand,
  type LucideIcon,
  NotebookPen,
  Shield,
  ShieldOff,
  Sparkles,
} from "lucide-react";
import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentIcon } from "../components/agent-icon.tsx";
import { useAgents } from "../state/agents.ts";
import { api } from "../state/connection.ts";
import { readiness, useMachineAgents } from "../state/machine-agents.ts";
import { reportError } from "../state/project.ts";

const ON_OFF = [
  ["on", "off"],
  ["true", "false"],
  ["enabled", "disabled"],
  ["yes", "no"],
];

/** The "on" value of an option that is really a switch (two values like on/off), else null. */
const switchOnValue = (option: ConfigOption): string | null => {
  if (option.options.length !== 2) {
    return null;
  }
  for (const [on, off] of ON_OFF) {
    const on_ = option.options.find(
      (o) => o.value.toLowerCase() === on || o.name.toLowerCase() === on
    );
    const off_ = option.options.find(
      (o) => o.value.toLowerCase() === off || o.name.toLowerCase() === off
    );
    if (on_ && off_) {
      return on_.value;
    }
  }
  return null;
};

const setConfigOption = (threadId: string, optionId: string, value: string) =>
  api()
    .request("threads.setConfigOption", { optionId, threadId, value })
    .catch(reportError);

export const currentName = (option: ConfigOption | undefined) =>
  option?.options.find((o) => o.value === option.currentValue)?.name;

const SwitchOptionItem = ({
  option,
  onValue,
  threadId,
}: {
  option: ConfigOption;
  onValue: string;
  threadId: string;
}) => {
  const checked = option.currentValue === onValue;
  const offValue =
    option.options.find((o) => o.value !== onValue)?.value ?? onValue;
  const onCheckedChange = (next: boolean) =>
    setConfigOption(threadId, option.id, next ? onValue : offValue);
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      className="pr-2 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden"
      onCheckedChange={onCheckedChange}
    >
      {option.name}
      <span
        aria-hidden
        className={cn(
          "ml-auto flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
          checked ? "bg-brand" : "bg-input"
        )}
      >
        <span
          className={cn(
            "size-3 rounded-full bg-white transition-transform",
            checked && "translate-x-3"
          )}
        />
      </span>
    </DropdownMenuCheckboxItem>
  );
};

/**
 * A choice among an option's values, in a submenu. The agent's unnamed default is not offered:
 * the value it stands for carries a badge instead.
 */
const SelectOptionSub = ({
  option,
  threadId,
}: {
  option: ConfigOption;
  threadId: string;
}) => {
  const onValueChange = (value: unknown) =>
    setConfigOption(threadId, option.id, value as string);
  const fallback = defaultChoice(option);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="shrink-0">{option.name}</span>
        <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">
          {currentName(option)}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={cn("max-h-80 min-w-48", roomyItems)}>
        <DropdownMenuRadioGroup
          onValueChange={onValueChange}
          value={option.currentValue}
        >
          {namedChoices(option).map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              <span className="flex min-w-0 flex-col">
                <span>{o.name}</span>
                {o.description ? (
                  <span className="max-w-64 whitespace-normal font-body text-muted-foreground">
                    {o.description}
                  </span>
                ) : null}
              </span>
              {o.value === fallback ? (
                <Badge className="ml-auto" variant="secondary">
                  Default
                </Badge>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};

/** The agent a thread's next prompt goes to, with its mark by each one. */
const AgentSub = ({ thread }: { thread: Thread }) => {
  const agents = useAgents((s) => s.agents);
  // Which are installed and signed in on this computer, where the shell can tell (Platform).
  const machine = useMachineAgents((s) => s.agents);
  useEffect(() => {
    useMachineAgents.getState().load().catch(reportError);
  }, []);
  const agent = agents.find((a) => a.id === thread.agentId);
  const busy = isBusy(thread.status);
  const onAgentChange = (agentId: unknown) => {
    if (agentId !== thread.agentId) {
      api()
        .request("threads.setAgent", {
          agentId: agentId as string,
          threadId: thread.id,
        })
        .catch(reportError);
    }
  };
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="shrink-0">Provider</span>
        <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-muted-foreground">
          <AgentIcon agentId={thread.agentId} className="size-3" />
          <span className="truncate">{agent?.name ?? thread.agentId}</span>
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={cn("min-w-48", roomyItems)}>
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup
            onValueChange={onAgentChange}
            value={thread.agentId}
          >
            {agents.map((a) => (
              <DropdownMenuRadioItem
                closeOnClick
                disabled={busy}
                key={a.id}
                value={a.id}
              >
                <AgentIcon agentId={a.id} />
                {a.name}
                {readiness(machine[a.id]) ? (
                  <span className="ml-auto pl-2 text-muted-foreground">
                    {readiness(machine[a.id])}
                  </span>
                ) : null}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};

/**
 * Agent, model and session options in one menu below the prompt: the provider first, then the
 * model, the effort and the agent's other choices; its switches below a divider. Before the
 * thread's session exists the options are the ones the agent offered last time, applied when it
 * starts.
 */
export const ModelPicker = ({ thread }: { thread: Thread }) => {
  const agents = useAgents((s) => s.agents);
  const agent = agents.find((a) => a.id === thread.agentId);
  // Session modes have their own picker next to this one.
  const hasModePicker = (thread.modes?.length ?? 0) > 0;
  // The agent's unnamed default is never shown: the thread starts on the first model it names.
  const options = withNamedChoices(thread.configOptions ?? []).filter(
    (o) => !(hasModePicker && o.category === "mode")
  );
  const model = options.find(isModelOption);
  const effort = options.find(isEffortOption);
  const switches = options.flatMap((o) => {
    const onValue = switchOnValue(o);
    return onValue ? [{ onValue, option: o }] : [];
  });
  const selects = options.filter(
    (o) => !(switchOnValue(o) || isModelOption(o) || o === effort)
  );
  const effortName =
    effort && !switchOnValue(effort) ? currentName(effort) : null;
  const agentName = agent?.name ?? thread.agentId;
  const modelName = model ? currentName(model) : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className={cn(pickerTrigger, "min-w-0")}
            size="sm"
            title={
              modelName ? `${agentName} · ${modelName}` : `Agent: ${agentName}`
            }
            variant="ghost"
          />
        }
      >
        <AgentIcon agentId={thread.agentId} className="size-3.5" />
        <span className="truncate">{modelName ?? agentName}</span>
        {effortName ? (
          <span className="@max-sm:hidden shrink-0 text-muted-foreground">
            {effortName}
          </span>
        ) : null}
        <ChevronDown
          className="shrink-0 text-muted-foreground"
          data-icon="inline-end"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn("w-64", roomyItems)}
        side="top"
      >
        <DropdownMenuGroup>
          <AgentSub thread={thread} />
          {model ? (
            <SelectOptionSub option={model} threadId={thread.id} />
          ) : null}
          {effort && !switchOnValue(effort) ? (
            <SelectOptionSub option={effort} threadId={thread.id} />
          ) : null}
          {selects.map((o) => (
            <SelectOptionSub key={o.id} option={o} threadId={thread.id} />
          ))}
        </DropdownMenuGroup>
        {switches.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {switches.map(({ option, onValue }) => (
                <SwitchOptionItem
                  key={option.id}
                  onValue={onValue}
                  option={option}
                  threadId={thread.id}
                />
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** The composer's menus have roomier rows than the editor's. */
export const roomyItems =
  "[&_[role^=menuitem]]:min-h-8 [&_[role^=menuitem]]:font-body";

/** The composer's pickers: plain at rest, on the secondary surface while hovered or open. */
const pickerTrigger =
  "shrink gap-1 px-1.5 font-normal hover:bg-secondary aria-expanded:bg-secondary dark:hover:bg-secondary";

/** What each agent's modes let it do, drawn small enough to stand for the mode alone. */
const MODE_ICONS: Record<string, LucideIcon> = {
  acceptEdits: FilePen,
  agent: Sparkles,
  "agent-full-access": ShieldOff,
  auto: Sparkles,
  bypassPermissions: ShieldOff,
  default: Hand,
  plan: NotebookPen,
  "read-only": Eye,
  "workspace-write": FolderPen,
};

const ModeIcon = ({ modeId }: { modeId: string | undefined }) => {
  const Icon = (modeId && MODE_ICONS[modeId]) || Shield;
  return <Icon className="size-3.5" />;
};

export const ModePicker = ({ thread }: { thread: Thread }) => {
  const modes = thread.modes ?? [];
  if (modes.length === 0) {
    return null;
  }
  const current = modes.find((m) => m.id === thread.currentModeId);
  const onValueChange = (modeId: unknown) =>
    api()
      .request("threads.setMode", {
        modeId: modeId as string,
        threadId: thread.id,
      })
      .catch(reportError);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className={cn(pickerTrigger, "min-w-7 shrink-0")}
            size="sm"
            title={current ? `Mode: ${current.name}` : "Mode"}
            variant="ghost"
          />
        }
      >
        <ModeIcon modeId={current?.id} />
        <span className="@max-sm:hidden truncate">
          {current?.name ?? "Mode"}
        </span>
        <ChevronDown
          className="@max-sm:hidden shrink-0 text-muted-foreground"
          data-icon="inline-end"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn("w-60", roomyItems)}
        side="top"
      >
        <DropdownMenuRadioGroup
          onValueChange={onValueChange}
          value={thread.currentModeId ?? null}
        >
          {modes.map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id}>
              <ModeIcon modeId={m.id} />
              <span className="flex min-w-0 flex-col">
                <span>{m.name}</span>
                {m.description ? (
                  <span className="whitespace-normal font-body text-muted-foreground">
                    {m.description}
                  </span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
