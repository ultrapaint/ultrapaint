/**
 * A component's slots (ADRs 0040, 0041): every part of a system component, or container of an app
 * component's tree, that holds nodes, with the layers that fill it, and what to put in it. A Dialog has its trigger, header, content and footer; a node added to the
 * footer is the instance's child that names `dialog-footer`, laid out as the footer lays out its
 * children. A child that names no slot fills the default one.
 */
import {
  type ComponentMeta,
  type ComponentSlot,
  metaOf,
} from "@ultrapaint/contracts/catalogue";
import { APP_FROM, SYSTEM_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import {
  type ElementId,
  newElement,
  newInstance,
} from "@ultrapaint/design-document/factories";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import { fillSlots } from "@ultrapaint/design-document/slots";
import { Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { insertNodesAt } from "../lib/node-actions.ts";
import { useComponents } from "../state/components.ts";
import { select } from "../state/selection.ts";
import { Row, Section } from "./inspector-fields.tsx";

/** What a slot can be given from here: the elements a slot is mostly made of, and a button. */
const ADDITIONS: readonly {
  readonly id: ElementId | "button";
  readonly label: string;
}[] = [
  { id: "paragraph", label: "Text" },
  { id: "row", label: "Row" },
  { id: "column", label: "Column" },
  { id: "button", label: "Button" },
];

const addTo = (
  frame: string,
  node: InstanceNode,
  slot: ComponentSlot,
  id: ElementId | "button",
  button: ComponentMeta | undefined
) => {
  const next = makeIdGenerator();
  const made =
    id === "button" && button
      ? newInstance(button, next)
      : newElement(id === "button" ? "paragraph" : id, next);
  const child: DesignNode =
    slot.holds === "default" ? made : { ...made, slot: slot.name };
  return insertNodesAt(
    {
      frame,
      index: node.children?.length ?? 0,
      kind: "into",
      parent: node.id,
    },
    [child],
    `Add to ${slot.label.toLowerCase()}`
  );
};

export const SlotsSection = ({
  frame,
  node,
}: {
  frame: string;
  node: InstanceNode;
}) => {
  const meta = useComponents((s) => metaOf(s.catalogue, node));
  const button = useComponents((s) =>
    s.catalogue.find((c) => c.name === "Button" && c.importFrom === SYSTEM_FROM)
  );
  const slots = (meta?.slots ?? []).filter((slot) => slot.holds);
  const fills = fillSlots(node, meta?.slots ?? []);
  if (
    !(node.from === SYSTEM_FROM || node.from === APP_FROM) ||
    slots.length === 0
  ) {
    return null;
  }
  return (
    <Section title="Slots">
      {slots.map((slot) => {
        const filling = fills.get(slot.name)?.nodes ?? [];
        const [first] = filling;
        return (
          <Row key={slot.name} label={slot.label}>
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      className="h-7 min-w-0 flex-1 truncate rounded-md px-2 text-left font-body transition-colors hover:bg-accent disabled:text-muted-foreground disabled:hover:bg-transparent"
                      disabled={!first}
                      onClick={() =>
                        first && select({ frame, nodeId: first.id })
                      }
                      type="button"
                    />
                  }
                >
                  {filling.length === 0
                    ? "Empty"
                    : `${filling.length} layer${filling.length === 1 ? "" : "s"}${slot.holds === "default" ? " · default" : ""}`}
                </TooltipTrigger>
                {first ? (
                  <TooltipContent>Select what fills it</TooltipContent>
                ) : null}
              </Tooltip>
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <DropdownMenuTrigger
                        aria-label={`Add to the ${slot.label.toLowerCase()}`}
                        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/25 aria-expanded:bg-accent aria-expanded:text-foreground"
                      />
                    }
                  >
                    <Plus className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Add to the {slot.label.toLowerCase()}
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end">
                  {ADDITIONS.map((addition) => (
                    <DropdownMenuItem
                      key={addition.id}
                      onClick={() =>
                        addTo(frame, node, slot, addition.id, button)
                      }
                    >
                      {addition.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </Row>
        );
      })}
    </Section>
  );
};
