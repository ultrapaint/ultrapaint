/**
 * The right panel on a board view (ADR 0045, B7): the inspector of the item open and of what is
 * picked on its boards, in the place of Design, Code and Comments. On Design system: a token's,
 * a colour group's or a text style's fields (`token-inspector.tsx`), a guideline's text
 * (`guideline-editor.tsx`), and with nothing picked what can be added to the foundation; a
 * project without a design system sees its Set up. On the Library: a system component's look at
 * the cell picked (`look-inspector.tsx`), an app component's properties, variants and slots
 * (`app-inspector.tsx`), and on the Overview the way to a component's board.
 */
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { tokenKindOf, tokenOf } from "@ultrapaint/contracts/token-table";
import { Ellipsis, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OVERVIEW } from "../boards/library-boards.ts";
import { useItemName } from "../canvas/board-canvas.tsx";
import { HideRightPanel } from "../components/title-bar.tsx";
import { Swatch } from "../lib/token-options.tsx";
import {
  type BoardPlace,
  pickOf,
  pickOnBoard,
  useBoard,
} from "../state/board.ts";
import { useComponents } from "../state/components.ts";
import { commitEdits, useDesignSystem } from "../state/design-system.ts";
import { useDesignSystemSetup } from "../state/design-system-setup.ts";
import { AppInspector, AppMenu } from "./app-inspector.tsx";
import { GuidelineEditor } from "./guideline-editor.tsx";
import { InspectedKey } from "./inspector-fields.tsx";
import { LookInspector, SystemMenu } from "./look-inspector.tsx";
import {
  FoundationActions,
  GroupInspector,
  TextStyleInspector,
  TokenInspector,
  tokenKindLabel,
} from "./token-inspector.tsx";

/** What the item open is, under its name. */
const useKind = (open: BoardPlace) => {
  const app = useComponents((s) =>
    s.catalogue.some((c) => c.name === open.item && c.importFrom === APP_FROM)
  );
  if (open.view === "system") {
    return open.item.startsWith("guide-") ? "Guideline" : "Foundation";
  }
  if (open.item === OVERVIEW) {
    return "Every component";
  }
  return app ? "App component" : "System component";
};

/** A picked node's id says what it stands for: `token:color-primary` is the token. */
const pickedName = (nodeId: string) => {
  const at = nodeId.indexOf(":");
  return { kind: nodeId.slice(0, at), name: nodeId.slice(at + 1) };
};

type Picked = ReturnType<typeof pickedName>;

/** What a pick is called under its name. */
const subtitleOf = (picked: Picked, itemName: string) => {
  if (picked.kind === "token") {
    return tokenKindLabel(picked.name);
  }
  if (picked.kind === "group") {
    return "Color group";
  }
  return picked.kind === "style"
    ? "Text style"
    : `${picked.kind} of ${itemName}`;
};

/** The operation that deletes what is picked, when it can be. */
const deleteOf = (picked: Picked, ds: DesignSystem) => {
  if (picked.kind === "token" && picked.name !== "spacing") {
    return tokenOf(ds, picked.name)
      ? {
          label: "Delete token",
          op: { name: picked.name, op: "removeToken" as const },
        }
      : null;
  }
  if (picked.kind === "style") {
    return ds.typography.styles.some((s) => s.name === picked.name)
      ? {
          label: "Delete text style",
          op: { name: picked.name, op: "removeTextStyle" as const },
        }
      : null;
  }
  return null;
};

/** The "…" of a pick: delete it, as one undo step, the pick let go. */
const PickMenu = ({ ds, picked }: { ds: DesignSystem; picked: Picked }) => {
  const remove = deleteOf(picked, ds);
  if (!remove) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button aria-label="More" size="icon" variant="ghost">
            <Ellipsis />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onClick={async () => {
            if (await commitEdits([remove.op])) {
              pickOnBoard(null);
            }
          }}
          variant="destructive"
        >
          <Trash2 />
          {remove.label}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** Design system's inspector body: the pick's fields, a guideline's text, or what can be added. */
const SystemBody = ({
  open,
  picked,
}: {
  open: BoardPlace;
  picked: Picked | null;
}) => {
  const ds = useDesignSystem((s) => s.designSystem);
  const document = useDesignSystem((s) => s.document);
  if (open.item.startsWith("guide-")) {
    return <GuidelineEditor document={document} item={open.item} />;
  }
  if (!ds) {
    return (
      <div className="flex flex-col items-start gap-2 p-3 font-body text-muted-foreground">
        The boards draw the neutral look every design starts with. Set up a
        design system to make it yours.
        <Button
          onClick={() => useDesignSystemSetup.getState().show(true)}
          size="sm"
        >
          Set up
        </Button>
      </div>
    );
  }
  if (picked?.kind === "token") {
    return <TokenInspector ds={ds} name={picked.name} />;
  }
  if (picked?.kind === "group") {
    return <GroupInspector ds={ds} name={picked.name} />;
  }
  if (picked?.kind === "style") {
    return <TextStyleInspector ds={ds} name={picked.name} />;
  }
  return (
    <>
      <p className="border-b p-3 font-body text-muted-foreground">
        Pick a token on the board to see it here.
      </p>
      <FoundationActions ds={ds} item={open.item} />
    </>
  );
};

/** The picked token's colour beside its name, in the design's first theme. */
const PickSwatch = ({ picked }: { picked: Picked | null }) => {
  const color = useDesignSystem((s) =>
    picked?.kind === "token" && tokenKindOf(picked.name) === "color"
      ? tokenOf(s.designSystem, picked.name)?.value
      : undefined
  );
  return color ? (
    <span className="flex size-6 shrink-0 [&>span]:size-6 [&>span]:rounded-md">
      <Swatch color={color} />
    </span>
  ) : null;
};

/** The Library's inspector body: the Overview's hint, a system component's look, an app component's. */
const LibraryBody = ({ open }: { open: BoardPlace }) => {
  const meta = useComponents((s) =>
    s.catalogue.find((c) => c.name === open.item)
  );
  const ds = useDesignSystem((s) => s.designSystem);
  if (open.item === OVERVIEW) {
    return (
      <div className="flex flex-col items-start gap-2 p-3 font-body text-muted-foreground">
        Click a component to open its board.
        {ds ? null : (
          <>
            <span>
              Every component is drawn in its default look. Set up a design
              system to draw them in yours.
            </span>
            <Button
              onClick={() => useDesignSystemSetup.getState().show(true)}
              size="sm"
            >
              Set up
            </Button>
          </>
        )}
      </div>
    );
  }
  return meta?.importFrom === APP_FROM ? (
    <AppInspector name={open.item} />
  ) : (
    <LookInspector meta={meta} name={open.item} />
  );
};

/** The "…" of the item open: a pick's on Design system, a component's on the Library. */
const HeaderMenu = ({
  kind,
  open,
  picked,
}: {
  kind: string;
  open: BoardPlace;
  picked: Picked | null;
}) => {
  const ds = useDesignSystem((s) => s.designSystem);
  if (open.view === "system") {
    return picked && ds ? <PickMenu ds={ds} picked={picked} /> : null;
  }
  if (open.item === OVERVIEW) {
    return null;
  }
  return kind === "App component" ? (
    <AppMenu name={open.item} />
  ) : (
    <SystemMenu name={open.item} />
  );
};

export const BoardInspector = ({ open }: { open: BoardPlace }) => {
  const pick = useBoard(pickOf);
  const kind = useKind(open);
  const name = useItemName(open);
  // On the Library the item is what the panel is about: a cell picked is its place, in the selects.
  const picked =
    pick && open.view === "system" ? pickedName(pick.nodeId) : null;
  const title = picked?.name ?? name;
  const subtitle = picked ? subtitleOf(picked, name) : kind;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <PickSwatch picked={picked} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span
            className={
              picked?.kind === "token"
                ? "truncate font-code font-medium"
                : "truncate font-medium"
            }
          >
            {title}
          </span>
          <span className="truncate font-body text-muted-foreground">
            {subtitle}
          </span>
        </div>
        <HeaderMenu kind={kind} open={open} picked={picked} />
        <HideRightPanel />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <InspectedKey.Provider
          value={pick ? `${pick.frame} ${pick.nodeId}` : open.item}
        >
          {open.view === "system" ? (
            <SystemBody open={open} picked={picked} />
          ) : (
            <LibraryBody open={open} />
          )}
        </InspectedKey.Provider>
      </div>
    </div>
  );
};
