/**
 * An app component edited in place (ADR 0041), in the inspector: its properties (added, renamed,
 * taken out, a choice's members), a field of the node selected exposed as one (a text's text, a
 * node's visibility, an image's picture, a nested instance's text or prop), and a container made
 * one of its slots. Each is a component change made on the file as the server has it (ADR 0042),
 * one undo step.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import { metaOf, type PropMeta } from "@ultrapaint/contracts/catalogue";
import type {
  AppComponentFile,
  ComponentChange,
  ComponentProperty,
  PropertyKind,
  PropertyTarget,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { isContainer, nodeLabel } from "@ultrapaint/design-document/tree";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { promptDialog } from "../components/dialogs.tsx";
import { Row, Section } from "../components/panel.tsx";
import { appComponentOf, useComponents } from "../state/components.ts";
import { api } from "../state/connection.ts";
import { useIsolation } from "../state/isolation.ts";
import { reportError } from "../state/project.ts";

/**
 * Changes the component's file on the server, as it is there now (ADR 0042); what the server
 * refuses is said.
 */
export const changeFile = async (
  file: AppComponentFile,
  change: ComponentChange
) => {
  try {
    await api().request("components.change", { change, name: file.name });
  } catch (error) {
    reportError(error);
  }
};

/** A members list edited as text: one member renamed, or the list as it now is. */
const membersChange = (
  property: ComponentProperty,
  members: readonly string[]
): ComponentChange => {
  const was = property.members ?? [];
  const changed = members.flatMap((m, i) => (m === was[i] ? [] : [i]));
  const [at] = changed;
  if (
    members.length === was.length &&
    changed.length === 1 &&
    at !== undefined &&
    !was.includes(members[at] ?? "")
  ) {
    return {
      member: was[at] ?? "",
      op: "renameMember",
      property: property.name,
      to: members[at] ?? "",
    };
  }
  return { members, name: property.name, op: "setProperty" };
};

/** A name no property has yet: `base`, else `base 2`, `base 3`… */
const freeName = (file: AppComponentFile, base: string) => {
  const taken = new Set(file.properties.map((p) => p.name));
  let name = base;
  for (let i = 2; taken.has(name); i += 1) {
    name = `${base} ${i}`;
  }
  return name;
};

export const KINDS: readonly {
  readonly kind: PropertyKind;
  readonly label: string;
}[] = [
  { kind: "text", label: "Text" },
  { kind: "boolean", label: "Yes or no" },
  { kind: "choice", label: "Choice" },
  { kind: "image", label: "Image" },
];

export const newProperty = (
  file: AppComponentFile,
  kind: PropertyKind
): ComponentProperty => {
  switch (kind) {
    case "boolean":
      return { default: true, kind, name: freeName(file, "shown") };
    case "choice":
      return {
        default: "default",
        kind,
        members: ["default", "other"],
        name: freeName(file, "variant"),
      };
    case "image":
      return { default: "", kind, name: freeName(file, "image") };
    default:
      return { default: "", kind, name: freeName(file, "text") };
  }
};

/** A property's value as it starts, edited as its kind is. */
const DefaultField = ({
  onChange,
  property,
}: {
  onChange: (value: JsonValue) => void;
  property: ComponentProperty;
}) => {
  if (property.kind === "boolean") {
    return (
      <Checkbox
        aria-label={`${property.name} when not set`}
        checked={property.default === true}
        onCheckedChange={(checked) => onChange(checked)}
      />
    );
  }
  if (property.kind === "choice") {
    return (
      <NativeSelect
        aria-label={`${property.name} when not set`}
        className="w-full"
        onChange={(e) => onChange(e.target.value)}
        size="sm"
        value={String(property.default)}
      >
        {(property.members ?? []).map((m) => (
          <NativeSelectOption key={m} value={m}>
            {m}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  }
  return (
    <Input
      aria-label={`${property.name} when not set`}
      className="h-7"
      defaultValue={String(property.default ?? "")}
      key={String(property.default)}
      onBlur={(e) => {
        if (e.target.value !== property.default) {
          onChange(e.target.value);
        }
      }}
      placeholder={property.kind === "image" ? "assets/picture.png" : "Text"}
    />
  );
};

/** What a property does to the tree, in a few words. */
const whatItSets = (property: ComponentProperty) => {
  const count = (property.targets ?? []).length;
  if (count > 0) {
    return `Sets ${count} field${count === 1 ? "" : "s"}.`;
  }
  return property.kind === "choice"
    ? "Its members are variants: edit the component in place at one to change it."
    : "Sets nothing yet: expose a node's field as it.";
};

export const PropertyRow = ({
  file,
  property,
}: {
  file: AppComponentFile;
  property: ComponentProperty;
}) => {
  const [name, setName] = useState(property.name);
  const rename = () => {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === property.name) {
      setName(property.name);
      return;
    }
    changeFile(file, {
      name: property.name,
      op: "renameProperty",
      to: trimmed,
    });
  };
  return (
    <div className="flex flex-col gap-1 rounded-md border px-2 py-1.5">
      <div className="flex items-center gap-1">
        <Input
          aria-label="The property's name"
          className="h-7 min-w-0 flex-1"
          onBlur={rename}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              rename();
            }
          }}
          value={name}
        />
        <span className="shrink-0 font-body text-muted-foreground">
          {KINDS.find((k) => k.kind === property.kind)?.label}
        </span>
        <Button
          aria-label={`Take ${property.name} out`}
          onClick={() =>
            changeFile(file, { name: property.name, op: "removeProperty" })
          }
          size="icon-xs"
          variant="ghost"
        >
          <X />
        </Button>
      </div>
      {property.kind === "choice" ? (
        <Row label="Members">
          <Input
            aria-label={`${property.name}'s members`}
            className="h-7"
            defaultValue={(property.members ?? []).join(", ")}
            key={(property.members ?? []).join(",")}
            onBlur={(e) => {
              const members = e.target.value
                .split(",")
                .map((m) => m.trim())
                .filter(Boolean);
              if (members.length > 0) {
                changeFile(file, membersChange(property, members));
              }
            }}
          />
        </Row>
      ) : null}
      <Row label="Default">
        <DefaultField
          onChange={(value) =>
            changeFile(file, {
              default: value,
              name: property.name,
              op: "setProperty",
            })
          }
          property={property}
        />
      </Row>
      <span className="font-body text-muted-foreground">
        {whatItSets(property)}
      </span>
    </div>
  );
};

/** A field of the node selected that a property can set. */
interface Exposable {
  readonly default: JsonValue;
  readonly kind: PropertyKind;
  readonly label: string;
  readonly members?: readonly string[];
  readonly name: string;
  readonly target: PropertyTarget;
}

/** A nested instance's prop as a property, when its type is one a property has. */
const exposedProp = (node: DesignNode, prop: PropMeta): Exposable | null => {
  const value =
    (node.type === "instance" ? node.props?.[prop.name] : undefined) ??
    prop.defaultValue;
  const target = { node: node.id, prop: prop.name };
  const { members } = prop.type;
  if (prop.type.kind === "enum" && members) {
    return {
      default: typeof value === "string" ? value : (members[0] ?? ""),
      kind: "choice",
      label: prop.name,
      members,
      name: prop.name,
      target,
    };
  }
  if (prop.type.kind === "boolean") {
    return {
      default: value === true,
      kind: "boolean",
      label: prop.name,
      name: prop.name,
      target,
    };
  }
  if (prop.type.kind === "string") {
    return {
      default: typeof value === "string" ? value : "",
      kind: "text",
      label: prop.name,
      name: prop.name,
      target,
    };
  }
  return null;
};

/** The fields of a node a property can set. */
const useExposable = (node: DesignNode, isRoot: boolean): Exposable[] => {
  const meta = useComponents((s) =>
    node.type === "instance" ? metaOf(s.catalogue, node) : undefined
  );
  const label = nodeLabel(node).toLowerCase();
  const fields: Exposable[] = [];
  if (node.type === "text") {
    fields.push({
      default: node.text,
      kind: "text",
      label: "Its text",
      name: label,
      target: { node: node.id },
    });
  }
  if (node.type === "image") {
    fields.push({
      default: node.src,
      kind: "image",
      label: "Its picture",
      name: label,
      target: { node: node.id },
    });
  }
  if (node.type === "instance" && (node.children?.length ?? 0) === 0) {
    fields.push({
      default: node.text ?? "",
      kind: "text",
      label: "Its text",
      name: `${label} text`,
      target: { node: node.id },
    });
  }
  if (!isRoot) {
    fields.push({
      default: node.hidden !== true,
      kind: "boolean",
      label: "Shown",
      name: `${label} shown`,
      target: { node: node.id },
    });
  }
  for (const prop of meta?.props ?? []) {
    const exposed = exposedProp(node, prop);
    if (exposed) {
      fields.push(exposed);
    }
  }
  return fields;
};

const sameTarget = (a: PropertyTarget, b: PropertyTarget) =>
  a.node === b.node && a.prop === b.prop;

/** The property that sets a field, when one does. */
const boundTo = (file: AppComponentFile, field: Exposable) =>
  file.properties.find(
    (p) =>
      p.kind === field.kind &&
      (p.targets ?? []).some((t) => sameTarget(t, field.target))
  );

const expose = (file: AppComponentFile, field: Exposable) =>
  changeFile(file, {
    op: "addProperty",
    property: {
      default: field.default,
      kind: field.kind,
      name: freeName(file, field.name),
      ...(field.members && { members: field.members }),
      targets: [field.target],
    },
  });

const unbind = (
  file: AppComponentFile,
  property: ComponentProperty,
  field: Exposable
) =>
  changeFile(file, {
    name: property.name,
    op: "setProperty",
    targets: (property.targets ?? []).filter(
      (t) => !sameTarget(t, field.target)
    ),
  });

/** What the node selected can give the component: a property, or a slot. */
const NodeSection = ({
  file,
  node,
}: {
  file: AppComponentFile;
  node: DesignNode;
}) => {
  const fields = useExposable(node, node.id === file.tree.id);
  const slot = file.slots.find((s) => s.node === node.id);
  const makeSlot = async () => {
    const name = await promptDialog({
      confirmLabel: "Make slot",
      defaultValue: nodeLabel(node).toLowerCase(),
      description:
        "An instance's children that name it fill it, in place of what it holds here.",
      placeholder: "actions",
      title: "A slot",
    });
    if (name?.trim()) {
      await changeFile(file, {
        op: "addSlot",
        slot: {
          ...(file.slots.length === 0 && { default: true }),
          name: name.trim(),
          node: node.id,
        },
      });
    }
  };
  return (
    <Section title="In the component">
      {fields.map((field) => {
        const property = boundTo(file, field);
        return (
          <Row
            key={`${field.target.prop ?? ""}:${field.kind}`}
            label={field.label}
          >
            {property ? (
              <>
                <span className="min-w-0 flex-1 truncate font-body">
                  {property.name}
                </span>
                <Button
                  aria-label={`Stop ${property.name} setting it`}
                  onClick={() => unbind(file, property, field)}
                  size="icon-xs"
                  variant="ghost"
                >
                  <X />
                </Button>
              </>
            ) : (
              <Button
                onClick={() => expose(file, field)}
                size="xs"
                variant="outline"
              >
                Expose as property
              </Button>
            )}
          </Row>
        );
      })}
      {isContainer(node) && !slot ? (
        <Row label="Slot">
          <Button onClick={makeSlot} size="xs" variant="outline">
            Make this a slot
          </Button>
        </Row>
      ) : null}
      {slot ? (
        <Row label="Slot">
          <span className="min-w-0 flex-1 truncate font-body">{slot.name}</span>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: the checkbox inside is Base UI's button */}
          <label className="flex shrink-0 items-center gap-1 font-body text-muted-foreground">
            <Checkbox
              checked={slot.default === true}
              onCheckedChange={(checked) =>
                changeFile(file, {
                  name: checked ? slot.name : null,
                  op: "defaultSlot",
                })
              }
            />
            default
          </label>
          <Button
            aria-label={`Take the slot ${slot.name} out`}
            onClick={() =>
              changeFile(file, { name: slot.name, op: "removeSlot" })
            }
            size="icon-xs"
            variant="ghost"
          >
            <X />
          </Button>
        </Row>
      ) : null}
    </Section>
  );
};

/**
 * The component edited in place in `frame`, with what the node selected can give it; nothing
 * while no component is edited there.
 */
export const IsolatedComponent = ({
  frame,
  node,
}: {
  frame: string;
  node: DesignNode;
}) => {
  const isolated = useIsolation((s) =>
    s.isolated?.frame === frame ? s.isolated : null
  );
  const file = useComponents((s) =>
    isolated ? appComponentOf(s.components, isolated.component) : undefined
  );
  if (!(isolated && file)) {
    return null;
  }
  return (
    <>
      <Section
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Add a property"
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground"
              title="Add a property"
            >
              <Plus className="size-3.5" />
            </DropdownMenuTrigger>
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
        }
        title={`${file.name}'s properties`}
      >
        {file.properties.length === 0 ? (
          <p className="font-body text-muted-foreground">
            What an instance sets. Expose a field of a node below, or add one.
          </p>
        ) : (
          file.properties.map((p) => (
            <PropertyRow file={file} key={p.name} property={p} />
          ))
        )}
      </Section>
      <NodeSection file={file} node={node} />
    </>
  );
};
