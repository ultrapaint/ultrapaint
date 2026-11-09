/**
 * A select drawn as its value and a chevron, as the chat composer's pickers are: it sits in a
 * row of text and says what is chosen without a field around it. Its menu lists the choices,
 * grouped when they say so, then any actions after a divider ("Choose a folder…").
 */

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";

/** The trigger's look, shared with the composer's own pickers. */
export const quietTrigger =
  "min-w-0 shrink gap-1 px-1.5 text-muted-foreground has-data-[icon=inline-end]:pr-1";

export interface QuietChoice {
  /** Choices with the same group are listed together under its name. */
  readonly group?: string;
  readonly label: string;
  readonly value: string;
}

export interface QuietAction {
  readonly label: string;
  readonly run: () => unknown;
}

const groupsOf = (choices: readonly QuietChoice[]) => {
  const groups = new Map<string, QuietChoice[]>();
  for (const choice of choices) {
    const key = choice.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), choice]);
  }
  return [...groups];
};

export const QuietSelect = ({
  actions = [],
  align = "start",
  choices,
  className,
  extra,
  icon,
  label,
  onChange,
  value,
}: {
  readonly actions?: readonly QuietAction[];
  /** Where the menu lines up with the trigger: `end` for one at the row's end. */
  readonly align?: "start" | "end";
  readonly choices: readonly QuietChoice[];
  /** `shrink-0` for one that keeps its whole value while the others truncate. */
  readonly className?: string;
  /** Muted after the value: the model's effort. */
  readonly extra?: string;
  readonly icon?: ReactNode;
  /** What it chooses, for a screen reader: "Model". */
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) => {
  const current = choices.find((c) => c.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`${label}: ${current?.label ?? "none"}`}
            className={cn(quietTrigger, className)}
            variant="ghost"
          />
        }
      >
        {icon}
        <span className="truncate">{current?.label}</span>
        {extra ? (
          <span className="@max-sm:hidden shrink-0">{extra}</span>
        ) : null}
        <ChevronDown className="size-3.5 shrink-0 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-60">
        <DropdownMenuRadioGroup
          onValueChange={(next: string) => onChange(next)}
          value={value}
        >
          {groupsOf(choices).map(([group, items]) => (
            <DropdownMenuGroup key={group}>
              {/* A group of one named as its group ("Codex" alone) says it once. */}
              {group && !(items.length === 1 && items[0]?.label === group) ? (
                <DropdownMenuLabel>{group}</DropdownMenuLabel>
              ) : null}
              {items.map((choice) => (
                <DropdownMenuRadioItem key={choice.value} value={choice.value}>
                  <span className="truncate">{choice.label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuRadioGroup>
        {actions.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {actions.map((action) => (
                <DropdownMenuItem key={action.label} onClick={action.run}>
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
