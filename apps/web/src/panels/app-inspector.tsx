/**
 * An app component on its board (ADRs 0041, 0045): the right panel while its board is open. Its
 * properties (added, renamed, taken out, a choice's members), its variants, a board each, with how
 * many fields each overrides, its slots, where it is used and its behaviour notes, each change a
 * component change made on its file as it is, one undo step. While its tree is edited in place on
 * a board and a node of it is selected, the panel is the page's inspector for that node, which
 * says what the node can give the component besides.
 */
import {
  APP_FROM,
  type AppComponentFile,
  variantKey,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { findNode, nodeLabel, walk } from "@ultrapaint/design-document/tree";
import { Code2, Component, Ellipsis, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  APP_DEFAULT_BOARD,
  type AppVariant,
  appBoardName,
  appInPlace,
  appVariantsOf,
  OVERVIEW,
} from "../boards/library-boards.ts";
import { promptDialog } from "../components/dialogs.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { startTask } from "../lib/start-thread.ts";
import { openBoard } from "../state/board.ts";
import { appComponentOf, useComponents } from "../state/components.ts";
import { useEditor } from "../state/editor.ts";
import { boardFrameOf } from "../state/frame-ref.ts";
import { isolate, useIsolation } from "../state/isolation.ts";
import { Notes } from "./component-notes.tsx";
import { ComponentUsedIn } from "./component-used-in.tsx";
import { Inspector } from "./inspector.tsx";
import {
  AddPropertyTrigger,
  changeFile,
  KINDS,
  newProperty,
  PropertyRow,
} from "./inspector-component.tsx";
import { EmptyState, Section } from "./inspector-fields.tsx";
import { removeComponent } from "./look-inspector.tsx";

/** The app component's file, by name. */
const useAppFile = (name: string) =>
  useComponents((s) => appComponentOf(s.components, name));

/** How many fields the tree's nodes override for a variant: what it draws differently. */
const overridesOf = (tree: DesignNode, key: string) => {
  let count = 0;
  for (const node of walk(tree)) {
    const { at } = node as { at?: Readonly<Record<string, object>> };
    count += Object.keys(at?.[key] ?? {}).length;
  }
  return count;
};

/** The "…" of an app component's board: implement it, delete it. */
export const AppMenu = ({ name }: { name: string }) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button aria-label="More" size="icon" variant="ghost">
          <Ellipsis />
        </Button>
      }
    />
    <DropdownMenuContent align="end" className="w-52">
      <DropdownMenuItem
        onClick={() => startTask({ _tag: "Implement", target: name })}
      >
        <Code2 />
        Implement
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={async () => {
          const removed = await removeComponent(name);
          if (removed) {
            openBoard({ item: OVERVIEW, view: "library" }, "replace");
          }
        }}
        variant="destructive"
      >
        <Trash2 />
        Delete component
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

/** Adds a property of a kind, from the section's +. */
const AddProperty = ({ file }: { file: AppComponentFile }) => (
  <DropdownMenu>
    <AddPropertyTrigger />
    <DropdownMenuContent align="end">
      {KINDS.map(({ kind, label }) => (
        <DropdownMenuItem
          key={kind}
          onClick={() =>
            changeFile(file, {
              op: "addProperty",
              property: newProperty(file, kind),
            })
          }
        >
          {label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

/**
 * A variant added: a member of the first choice, named in a prompt; without a choice, a choice of
 * two members, each a board.
 */
const addVariant = async (file: AppComponentFile) => {
  const choice = file.properties.find((p) => p.kind === "choice");
  if (!choice) {
    await changeFile(file, {
      op: "addProperty",
      property: newProperty(file, "choice"),
    });
    return;
  }
  const member = await promptDialog({
    confirmLabel: "Add variant",
    description: `A member of ${choice.name}: its board draws the component with it, and what is edited there lands on it.`,
    placeholder: "featured",
    title: `A variant of ${file.name}`,
  });
  const name = member?.trim();
  if (name && !(choice.members ?? []).includes(name)) {
    await changeFile(file, {
      members: [...(choice.members ?? []), name],
      name: choice.name,
      op: "setProperty",
    });
  }
};

/** A variant's row: its board's name and what it overrides; a click edits it in place there. */
const VariantRow = ({
  file,
  variant,
}: {
  file: AppComponentFile;
  variant: AppVariant | null;
}) => {
  const name = appBoardName(variant);
  const frame = boardFrameOf({ item: file.name, name, view: "library" });
  const editing = useIsolation((s) => s.isolated?.frame === frame);
  const inPlace = appInPlace(file, variant);
  const label = name === APP_DEFAULT_BOARD ? file.name : name;
  const overrides = inPlace.variant
    ? overridesOf(
        file.tree,
        variantKey(variant?.property ?? "", variant?.member ?? "")
      )
    : 0;
  return (
    <button
      aria-current={editing ? "true" : undefined}
      className="-mx-2 flex h-7 items-center gap-2 rounded-md px-2 text-left font-body font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/25 aria-[current=true]:bg-accent"
      onClick={() =>
        isolate(frame, inPlace.instance, { variant: inPlace.variant })
      }
      title={`Edit ${file.name} in place on ${name}`}
      type="button"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 font-body-small text-muted-foreground tabular-nums">
        {inPlace.variant
          ? `${overrides} ${overrides === 1 ? "override" : "overrides"}`
          : "Base"}
      </span>
    </button>
  );
};

/** What a slot holds in the tree: its node, by name. */
const slotHolder = (file: AppComponentFile, node: string) => {
  const found = findNode(file.tree, node);
  return found ? nodeLabel(found) : node;
};

/** The component's own panel: properties, variants, slots, where it is used, notes. */
const AppBody = ({ file }: { file: AppComponentFile }) => {
  const variants = appVariantsOf(file);
  return (
    <>
      {file.description ? (
        <p className="border-b px-3 py-2.5 font-body-small text-muted-foreground">
          {file.description}
        </p>
      ) : null}
      <Section action={<AddProperty file={file} />} title="Properties">
        {file.properties.length === 0 ? (
          <p className="font-body-small text-muted-foreground">
            What an instance sets. Double-click the component to edit it in
            place, and expose a field of a node, or add one.
          </p>
        ) : (
          file.properties.map((p) => (
            <PropertyRow file={file} key={p.name} property={p} />
          ))
        )}
      </Section>
      <Section
        action={
          <IconButton
            className="text-muted-foreground"
            onClick={() => addVariant(file)}
            size="icon-sm"
            tooltip="Add a variant"
          >
            <Plus />
          </IconButton>
        }
        title="Variants"
      >
        {(variants.length > 0 ? variants : [null]).map((v) => (
          <VariantRow file={file} key={appBoardName(v)} variant={v} />
        ))}
      </Section>
      <Section title="Slots">
        {file.slots.length === 0 ? (
          <p className="font-body-small text-muted-foreground">
            None yet. Select a container of the tree and make it a slot.
          </p>
        ) : (
          file.slots.map((slot) => (
            <div
              className="grid min-h-7 grid-cols-[72px_minmax(0,1fr)] items-center gap-x-2 font-body"
              key={slot.name}
            >
              <span className="truncate font-code">{slot.name}</span>
              <span className="truncate text-muted-foreground">
                {slotHolder(file, slot.node)}
                {slot.default ? " · default" : ""}
              </span>
            </div>
          ))
        )}
      </Section>
      <ComponentUsedIn from={APP_FROM} name={file.name} />
      <Section title="Notes">
        <Notes
          component={file}
          parts={file.slots.map((s) => ({
            label: s.label ?? s.name,
            name: s.name,
          }))}
        />
      </Section>
    </>
  );
};

/**
 * An app component's inspector on its board: the page's inspector for the node selected in its
 * tree edited in place, else the component's own panel.
 */
export const AppInspector = ({ name }: { name: string }) => {
  const file = useAppFile(name);
  const editedIn = useIsolation((s) =>
    s.isolated?.component === name ? s.isolated.frame : null
  );
  const selectedInTree = useEditor(
    (s) => editedIn !== null && s.selection?.frame === editedIn
  );
  if (!file) {
    return (
      <EmptyState icon={<Component />} title={`${name} is gone`}>
        It is not among the components any more.
      </EmptyState>
    );
  }
  return selectedInTree ? <Inspector /> : <AppBody file={file} />;
};
