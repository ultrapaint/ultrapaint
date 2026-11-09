/**
 * The composer's model menu: the agent, its model, effort and options, and what it may do without
 * asking (its session mode, "Permissions"), as the agent offers them (ADR 0063).
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
import {
  ChevronDown,
  Eye,
  FilePen,
  FolderPen,
  type LucideIcon,
  NotebookPen,
  Shield,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
} from "lucide-react";
import type * as React from "react";
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
import { cn } from "@/lib/cn";
import { AgentIcon } from "../components/agent-icon.tsx";
import { quietTrigger } from "../components/quiet-select.tsx";
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
  if (option.type === "boolean") {
    return "true";
  }
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
      {/* The system Switch's look: off, edged and its knob muted (DESIGN.md). */}
      <span
        aria-hidden
        className={cn(
          "ml-auto flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
          checked ? "bg-brand" : "ring-1 ring-muted-foreground ring-inset"
        )}
      >
        <span
          className={cn(
            "size-3 rounded-full transition-transform",
            checked ? "translate-x-3 bg-white" : "bg-muted-foreground"
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
        <span className="min-w-0 flex-1 truncate text-right font-body-small text-muted-foreground">
          {currentName(option)}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 min-w-52">
        <DropdownMenuRadioGroup
          onValueChange={onValueChange}
          value={option.currentValue}
        >
          {namedChoices(option).map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              <span className="flex min-w-0 flex-1 flex-col py-0.5">
                <span className="flex items-center gap-2">
                  {o.name}
                  {o.value === fallback ? <Badge>Default</Badge> : null}
                </span>
                {o.description ? (
                  <span className="max-w-64 whitespace-normal font-body-small text-muted-foreground">
                    {o.description}
                  </span>
                ) : null}
              </span>
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
        <span className="shrink-0">Agent</span>
        <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5 font-body-small text-muted-foreground">
          <AgentIcon agentId={thread.agentId} className="size-3" />
          <span className="truncate">{agent?.name ?? thread.agentId}</span>
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-52">
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
                  <span className="ml-auto pl-2 font-body-small text-muted-foreground">
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
 * What the agent may do without asking: its session modes, each with its icon and what it lets
 * the agent do. Changed on the live session when there is one, else for the next.
 */
const PermissionsSub = ({ thread }: { thread: Thread }) => {
  const modes = thread.modes ?? [];
  const current = modes.find((m) => m.id === thread.currentModeId);
  const onValueChange = (modeId: unknown) =>
    api()
      .request("threads.setMode", {
        modeId: modeId as string,
        threadId: thread.id,
      })
      .catch(reportError);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="shrink-0">Permissions</span>
        <span className="min-w-0 flex-1 truncate text-right font-body-small text-muted-foreground">
          {current?.name}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-72">
        <DropdownMenuRadioGroup
          onValueChange={onValueChange}
          value={thread.currentModeId ?? null}
        >
          {modes.map((m) => (
            <DropdownMenuRadioItem
              className="items-start"
              key={m.id}
              value={m.id}
            >
              <span className="flex h-5 items-center">
                <ModeIcon modeId={m.id} />
              </span>
              <span className="flex min-w-0 flex-col py-0.5">
                <span>{m.name}</span>
                {m.description ? (
                  <span className="whitespace-normal text-pretty font-body-small text-muted-foreground">
                    {m.description}
                  </span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};

/**
 * Agent, model, effort, permissions and the agent's other options in one menu below the prompt;
 * its switches below a divider. The trigger names the model and effort, led by the permission
 * mode's icon, which stays in view in every mode so full access is never out of sight. Before the
 * thread's session exists the options are the ones the agent offered last time, applied when it
 * starts.
 */
export const ModelPicker = ({ thread }: { thread: Thread }) => {
  const agents = useAgents((s) => s.agents);
  const agent = agents.find((a) => a.id === thread.agentId);
  const modes = thread.modes ?? [];
  const hasModes = modes.length > 0;
  // The agent's unnamed default is never shown: the thread starts on the first model it names.
  // A mode offered as an option too is Permissions' to show.
  const options = withNamedChoices(thread.configOptions ?? []).filter(
    (o) => !(hasModes && o.category === "mode")
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
  const mode = modes.find((m) => m.id === thread.currentModeId);
  const label = [
    modelName ? `${agentName}, ${modelName}` : agentName,
    effortName,
    mode ? `permissions: ${mode.name}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  // The permission mode's icon leads; without modes, the agent's mark when no model names it
  // (the agent is named in the thread's header).
  let lead: React.ReactNode = null;
  if (mode) {
    lead = <ModeIcon className="size-3.5" modeId={mode.id} />;
  } else if (!modelName) {
    lead = <AgentIcon agentId={thread.agentId} className="size-3.5" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`Agent and model: ${label}`}
            className={pickerTrigger}
            variant="ghost"
          />
        }
      >
        {lead}
        <span className="truncate">{modelName ?? agentName}</span>
        {effortName ? (
          // The menu names it; a narrow composer keeps the model and the review legible.
          <span className="@max-sm:hidden shrink-0 opacity-70">
            {effortName}
          </span>
        ) : null}
        <ChevronDown className="size-3.5 shrink-0 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60" side="top">
        <DropdownMenuGroup>
          <AgentSub thread={thread} />
          {model ? (
            <SelectOptionSub option={model} threadId={thread.id} />
          ) : null}
          {effort && !switchOnValue(effort) ? (
            <SelectOptionSub option={effort} threadId={thread.id} />
          ) : null}
          {hasModes ? <PermissionsSub thread={thread} /> : null}
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

/**
 * The composer's pickers, quiet selects: their value and a chevron in muted text, filled only
 * under the pointer or while open. They give up width before the send button does.
 */
const pickerTrigger = quietTrigger;

/** What each agent's modes let it do, drawn small enough to stand for the mode alone. */
const MODE_ICONS: Record<string, LucideIcon> = {
  acceptEdits: FilePen,
  agent: ShieldCheck,
  "agent-full-access": ShieldOff,
  auto: ShieldCheck,
  bypassPermissions: ShieldOff,
  default: ShieldQuestion,
  plan: NotebookPen,
  "read-only": Eye,
  "workspace-write": FolderPen,
};

export const ModeIcon = ({
  className,
  modeId,
}: {
  className?: string;
  modeId: string | undefined;
}) => {
  const Icon = (modeId && MODE_ICONS[modeId]) || Shield;
  return (
    <Icon
      aria-hidden
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    />
  );
};
