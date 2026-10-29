/**
 * A system component's slots (ADR 0040): every part of it that holds nodes, with the layers that fill it,
 * and what to put in it. A Dialog has its trigger, header, content and footer; a node added to the
 * footer is the instance's child that names `dialog-footer`, laid out as the footer lays out its
 * children. A child that names no slot fills the default one.
 */
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import { SYSTEM_FROM } from "@ultrapaint/contracts/spec-names";
import {
  type ElementId,
  newElement,
  newInstance,
} from "@ultrapaint/design-document/factories";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import { Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Row, Section } from "../components/panel.tsx";
import { insertNodesAt } from "../lib/node-actions.ts";
import { childrenInSlot, type Slot } from "../lib/slots.ts";
import { componentMetaOf, useCatalogue } from "../state/catalogue.ts";
import { useEditor } from "../state/editor.ts";

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
  slot: Slot,
  id: ElementId | "button",
  button: ComponentMeta | undefined
) => {
  const next = makeIdGenerator();
  const made =
    id === "button" && button
      ? newInstance(button, undefined, next)
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
  const meta = useCatalogue((s) => componentMetaOf(s.catalogue, node));
  const button = useCatalogue((s) =>
    s.catalogue?.components.find(
      (c) => c.name === "Button" && c.importFrom === SYSTEM_FROM
    )
  );
  const slots = (meta?.slots ?? []).filter((slot) => slot.holds);
  if (node.from !== SYSTEM_FROM || slots.length === 0) {
    return null;
  }
  return (
    <Section title="Slots">
      {slots.map((slot) => {
        const filling = childrenInSlot(node, slot, slots);
        const [first] = filling;
        return (
          <Row key={slot.name} label={slot.label}>
            <div className="flex min-w-0 items-center gap-1">
              <button
                className="min-w-0 flex-1 truncate rounded px-1 text-left font-body text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                disabled={!first}
                onClick={() =>
                  first &&
                  useEditor.getState().select({ frame, nodeId: first.id })
                }
                title={
                  first
                    ? "Select what fills it"
                    : `Nothing in the ${slot.label}`
                }
                type="button"
              >
                {filling.length === 0
                  ? "Empty"
                  : `${filling.length} layer${filling.length === 1 ? "" : "s"}${slot.holds === "default" ? " · default" : ""}`}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Add to the ${slot.label.toLowerCase()}`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  title={`Add to the ${slot.label.toLowerCase()}`}
                >
                  <Plus className="size-3.5" />
                </DropdownMenuTrigger>
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
