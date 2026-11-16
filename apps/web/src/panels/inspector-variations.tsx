/**
 * The inspector's Variations section (ADR 0098), for every selection: its header with + (a new
 * variation, the one in use copied to edit by hand) and ⋯ (clear them), and with more than the
 * original a row per variation, In use beside one. A text's row is its words, an image's its
 * picture, anything else's its name and what it varied. A click lays them out beside the page
 * with that one in the preview; a row's own menu renames or deletes it.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  ORIGINAL_ID,
  type Variation,
  type VariationSet,
} from "@ultrapaint/contracts/variations";
import { Ellipsis, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { assetsAddress } from "../canvas/preview-module.ts";
import { promptDialog } from "../components/dialogs.tsx";
import { useEditor } from "../state/editor.ts";
import { reportError } from "../state/project.ts";
import {
  clearVariations,
  deleteVariation,
  newVariation,
  openVariations,
  renameVariation,
  setOf,
  type Thing,
  targetOf,
  useVariations,
} from "../state/variations.ts";
import { Section, SectionAction } from "./inspector-fields.tsx";

const URL_RE = /^[a-z]+:/i;
const LEADING_DOT_SLASH_RE = /^\.\//;

/** A picture's URL, as the frames ask for it: a path of the canvas's, through the server. */
const pictureOf = (src: string, canvas: string) =>
  URL_RE.test(src)
    ? src
    : `${assetsAddress()}?${new URLSearchParams({ canvas, src: src.replace(LEADING_DOT_SLASH_RE, "") })}`;

/** What a row shows of a variation: a text's words, an image's picture, else its name. */
const RowBody = ({
  canvas,
  tree,
  variation,
}: {
  canvas: string;
  tree: DesignNode | undefined;
  variation: Variation;
}) => {
  if (tree?.type === "text") {
    return <span className="min-w-0 flex-1 truncate">{tree.text}</span>;
  }
  if (tree?.type === "image" && typeof tree.src === "string") {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <img
          alt={variation.name}
          className="size-6 shrink-0 rounded-sm object-cover ring-1 ring-foreground/10"
          height={24}
          src={pictureOf(tree.src, canvas)}
          width={24}
        />
        <span className="min-w-0 truncate">{variation.name}</span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="shrink-0">{variation.name}</span>
      {variation.varied ? (
        <span className="min-w-0 truncate font-body-small text-muted-foreground">
          {variation.varied}
        </span>
      ) : null}
    </span>
  );
};

const rename = async (thing: Thing, variation: Variation) => {
  const name = (
    await promptDialog({
      confirmLabel: "Rename",
      defaultValue: variation.name,
      title: "Rename the variation",
    })
  )?.trim();
  if (name && name !== variation.name) {
    await renameVariation(thing, variation.id, name).catch(reportError);
  }
};

/** A variation's row: a click lays them out with it in the preview; right-click, its menu. */
const VariationRow = ({
  canvas,
  inUse,
  node,
  thing,
  variation,
}: {
  canvas: string;
  inUse: boolean;
  node: DesignNode;
  thing: Thing;
  variation: Variation;
}) => (
  <ContextMenu>
    <ContextMenuTrigger
      render={
        <button
          aria-label={variation.name}
          className="-mx-2 flex h-7 items-center gap-2 rounded-md px-2 text-left font-body-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/25"
          data-variation-row={variation.id}
          onClick={() => openVariations(thing, variation.id)}
          type="button"
        />
      }
    >
      <RowBody
        canvas={canvas}
        tree={inUse ? node : variation.tree}
        variation={variation}
      />
      {inUse ? (
        <Badge className="shrink-0" variant="outline">
          In use
        </Badge>
      ) : null}
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem
        onClick={() => rename(thing, variation).catch(reportError)}
      >
        Rename
      </ContextMenuItem>
      {/* The original stays while other variations remain. */}
      <ContextMenuItem
        disabled={variation.id === ORIGINAL_ID}
        onClick={() => deleteVariation(thing, variation.id).catch(reportError)}
        variant="destructive"
      >
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
);

/** The section's ⋯: what acts on the whole set. */
const SetMenu = ({ thing }: { thing: Thing }) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          aria-label="More about the variations"
          className="text-muted-foreground"
          size="icon-sm"
          variant="ghost"
        >
          <Ellipsis />
        </Button>
      }
    />
    <DropdownMenuContent align="end">
      <DropdownMenuItem
        onClick={() => clearVariations(thing).catch(reportError)}
        variant="destructive"
      >
        Clear variations
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

/** The variations of the node selected in `frame`. */
export const VariationsSection = ({
  doc,
  frame,
  node,
}: {
  /** Its document, when the frame does not show it: a component's, drawn on its board. */
  doc?: string;
  frame: string;
  node: DesignNode;
}) => {
  const thing = { doc, frame, nodeId: node.id };
  const target = targetOf(thing);
  const set: VariationSet | undefined = useVariations((s) =>
    setOf(s, target.doc, node.id)
  );
  const canvas = useEditor((s) => s.canvas) ?? "";
  return (
    <Section
      action={
        <>
          <SectionAction
            onClick={() => newVariation(thing).catch(reportError)}
            tooltip="New variation"
          >
            <Plus />
          </SectionAction>
          {set ? <SetMenu thing={thing} /> : null}
        </>
      }
      title="Variations"
    >
      {set?.variations.map((variation) => (
        <VariationRow
          canvas={canvas}
          inUse={variation.id === set.inUse}
          key={variation.id}
          node={node}
          thing={thing}
          variation={variation}
        />
      ))}
    </Section>
  );
};
