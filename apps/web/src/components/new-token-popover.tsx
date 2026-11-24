/**
 * New token, on a field whose value is outside the design system (ADR 0136): the token's name,
 * started with its kind's prefix, checked as the Design system place checks it. Enter or Add
 * token adds it; Escape and the close button let it go, adding nothing.
 */
import { XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle } from "@/components/ui/popover";

export const NewTokenPopover = ({
  anchor,
  nameOf,
  onAdd,
  onCancel,
  prefix,
}: {
  /** The field it names the token for. */
  anchor: HTMLElement;
  /** Whether a name can be the token's, and why not. */
  nameOf: (name: string) => {
    readonly problem: string | null;
    readonly ready: boolean;
  };
  onAdd: (name: string) => void;
  onCancel: () => void;
  /** What the name starts as: `color-`. */
  prefix: string;
}) => {
  const [name, setName] = useState(prefix);
  const { problem, ready } = nameOf(name);
  const add = () => {
    if (ready) {
      onAdd(name);
    }
  };
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
      open
    >
      <PopoverContent align="start" anchor={anchor} className="w-64 gap-2">
        <div className="flex items-center justify-between">
          <PopoverTitle>New token</PopoverTitle>
          <Button
            aria-label="Close"
            onClick={onCancel}
            size="icon-xs"
            variant="ghost"
          >
            <XIcon />
          </Button>
        </div>
        <Input
          aria-label="The new token's name"
          autoFocus
          className="h-7"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              add();
            }
          }}
          value={name}
        />
        {problem ? (
          <span className="font-body-small text-destructive">{problem}</span>
        ) : null}
        <Button
          className="self-end"
          disabled={!ready}
          onClick={add}
          size="sm"
          variant="secondary"
        >
          Add token
        </Button>
      </PopoverContent>
    </Popover>
  );
};
